"""Service for syncing skills from git repositories."""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import aiofiles
import structlog
import yaml
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import SkillRepository, SkillSyncLog, UserSkill

logger = structlog.get_logger()


@dataclass
class SyncResult:
    """Result of a skill sync operation."""

    success: bool
    skills_added: int = 0
    skills_updated: int = 0
    skills_removed: int = 0
    error: str | None = None


class SkillSyncService:
    """Service for syncing skills from git repositories."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def sync_repository(
        self,
        repository: SkillRepository,
        sync_log: SkillSyncLog,
    ) -> SyncResult:
        """Sync skills from a git repository.

        Args:
            repository: The repository to sync from
            sync_log: The sync log entry to update

        Returns:
            SyncResult with counts of added/updated/removed skills
        """
        try:
            # Clone/pull repository to temp directory
            repo_path = await self._clone_repository(
                repository.repo_url,
                repository.branch,
            )

            if not repo_path:
                return SyncResult(success=False, error="Failed to clone repository")

            try:
                # Parse skill files
                skills_path = Path(repo_path) / repository.skills_path.strip("/")
                skill_files = await self._find_skill_files(skills_path)

                if not skill_files:
                    logger.info(
                        "No skill files found",
                        path=str(skills_path),
                        repo_id=repository.id,
                    )
                    return SyncResult(success=True)

                # Parse and validate skills
                parsed_skills = await self._parse_skill_files(skill_files)

                if repository.sync_direction == "pull":
                    result = await self._sync_pull(
                        repository.user_id,
                        repository.id,
                        parsed_skills,
                    )
                elif repository.sync_direction == "push":
                    result = await self._sync_push(
                        repository.user_id,
                        repository.id,
                        repo_path,
                        repository.skills_path,
                    )
                else:  # bidirectional
                    result = await self._sync_bidirectional(
                        repository.user_id,
                        repository.id,
                        parsed_skills,
                        repo_path,
                        repository.skills_path,
                    )

                # Update sync log
                await self._update_sync_log(
                    sync_log,
                    success=True,
                    skills_added=result.skills_added,
                    skills_updated=result.skills_updated,
                    skills_removed=result.skills_removed,
                )

                # Update repository
                await self._update_repository_sync_status(
                    repository.id,
                    status="success",
                )

                return result

            finally:
                # Cleanup temp directory
                shutil.rmtree(repo_path, ignore_errors=True)

        except Exception as e:
            logger.exception(
                "Sync failed",
                repo_id=repository.id,
                error=str(e),
            )

            await self._update_sync_log(
                sync_log,
                success=False,
                error=str(e),
            )

            await self._update_repository_sync_status(
                repository.id,
                status="failed",
                error=str(e),
            )

            return SyncResult(success=False, error=str(e))

    async def _clone_repository(
        self,
        repo_url: str,
        branch: str,
    ) -> str | None:
        """Clone a git repository to a temporary directory.

        Returns the path to the cloned repository, or None on failure.
        """
        temp_dir = tempfile.mkdtemp(prefix="skill_sync_")

        try:
            # Use subprocess to clone
            process = await asyncio.create_subprocess_exec(
                "git",
                "clone",
                "--depth",
                "1",
                "--branch",
                branch,
                repo_url,
                temp_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _stdout, stderr = await process.communicate()

            if process.returncode != 0:
                logger.error(
                    "Git clone failed",
                    repo_url=repo_url,
                    branch=branch,
                    stderr=stderr.decode(),
                )
                shutil.rmtree(temp_dir, ignore_errors=True)
                return None
        except Exception as e:
            logger.exception("Failed to clone repository", error=str(e))
            shutil.rmtree(temp_dir, ignore_errors=True)
            return None
        else:
            return temp_dir

    async def _find_skill_files(self, skills_path: Path) -> list[Path]:
        """Find all YAML skill files in a directory."""
        skill_files: list[Path] = []

        if not skills_path.exists():
            return skill_files

        for pattern in ["*.yaml", "*.yml"]:
            skill_files.extend(skills_path.glob(pattern))
            skill_files.extend(skills_path.glob(f"**/{pattern}"))

        return sorted(set(skill_files))

    async def _parse_skill_files(
        self,
        files: list[Path],
    ) -> list[dict[str, Any]]:
        """Parse YAML skill files into dictionaries."""
        skills = []

        for file_path in files:
            try:
                async with aiofiles.open(file_path) as f:
                    file_content = await f.read()
                    content = yaml.safe_load(file_content)

                if not content:
                    continue

                # Handle single skill or list of skills
                if isinstance(content, list):
                    for skill in content:
                        if self._validate_skill(skill):
                            skill["_source_file"] = str(file_path)
                            skills.append(skill)
                elif isinstance(content, dict) and self._validate_skill(content):
                    content["_source_file"] = str(file_path)
                    skills.append(content)

            except Exception as e:
                logger.warning(
                    "Failed to parse skill file",
                    file=str(file_path),
                    error=str(e),
                )
                continue

        return skills

    def _validate_skill(self, skill: dict[str, Any]) -> bool:
        """Validate a skill dictionary has required fields."""
        required = ["name", "slug", "description"]
        return all(skill.get(field) for field in required)

    async def _sync_pull(
        self,
        user_id: str,
        repo_id: str,
        parsed_skills: list[dict[str, Any]],
    ) -> SyncResult:
        """Pull skills from repository into database."""
        added = 0
        updated = 0
        removed = 0

        # Get existing skills from this repo
        existing_query = select(UserSkill).where(
            UserSkill.user_id == user_id,
            UserSkill.source_repository_id == repo_id,
        )
        result = await self.db.execute(existing_query)
        existing_skills = {s.slug: s for s in result.scalars().all()}

        # Track which slugs we've seen
        seen_slugs = set()

        for skill_data in parsed_skills:
            slug = skill_data["slug"]
            seen_slugs.add(slug)

            if slug in existing_skills:
                # Update existing skill
                existing = existing_skills[slug]
                await self._update_skill_from_data(existing, skill_data)
                updated += 1
            else:
                # Create new skill
                await self._create_skill_from_data(user_id, repo_id, skill_data)
                added += 1

        # Remove skills no longer in repo
        for slug, skill in existing_skills.items():
            if slug not in seen_slugs:
                await self.db.delete(skill)
                removed += 1

        await self.db.commit()

        return SyncResult(
            success=True,
            skills_added=added,
            skills_updated=updated,
            skills_removed=removed,
        )

    async def _sync_push(
        self,
        user_id: str,
        repo_id: str,
        repo_path: str,
        skills_path: str,
    ) -> SyncResult:
        """Push user skills to repository."""
        # Get user's skills for this repo
        query = select(UserSkill).where(
            UserSkill.user_id == user_id,
            UserSkill.source_repository_id == repo_id,
        )
        result = await self.db.execute(query)
        skills = result.scalars().all()

        added = 0
        target_dir = Path(repo_path) / skills_path.strip("/")
        target_dir.mkdir(parents=True, exist_ok=True)

        for skill in skills:
            # Convert to YAML
            skill_dict = {
                "name": skill.name,
                "slug": skill.slug,
                "description": skill.description,
                "version": skill.version,
                "triggers": skill.triggers or [],
                "tags": skill.tags or [],
                "required_tools": skill.required_tools or [],
                "steps": skill.steps or [],
            }
            if skill.system_prompt:
                skill_dict["system_prompt"] = skill.system_prompt

            # Write to file
            file_path = target_dir / f"{skill.slug}.yaml"
            yaml_content = yaml.dump(skill_dict, default_flow_style=False, allow_unicode=True)
            async with aiofiles.open(file_path, "w") as f:
                await f.write(yaml_content)
            added += 1

        # Commit and push
        try:
            await self._git_commit_and_push(
                repo_path,
                f"Update skills from Podex ({added} skills)",
            )
        except Exception as e:
            logger.warning("Failed to push changes", error=str(e))
            return SyncResult(success=False, error=f"Push failed: {e}")

        return SyncResult(success=True, skills_added=added)

    async def _sync_bidirectional(
        self,
        user_id: str,
        repo_id: str,
        parsed_skills: list[dict[str, Any]],
        repo_path: str,
        skills_path: str,
    ) -> SyncResult:
        """Bidirectional sync - merge changes from both sides."""
        # First, pull from repo
        pull_result = await self._sync_pull(user_id, repo_id, parsed_skills)

        # Then, push any local-only skills
        # (skills created in Podex that aren't in repo)
        query = select(UserSkill).where(
            UserSkill.user_id == user_id,
            UserSkill.source_repository_id == repo_id,
            UserSkill.generated_by_agent == True,  # Only push agent-generated skills
        )
        result = await self.db.execute(query)
        local_skills = result.scalars().all()

        repo_slugs = {s["slug"] for s in parsed_skills}
        skills_to_push = [s for s in local_skills if s.slug not in repo_slugs]

        pushed = 0
        if skills_to_push:
            target_dir = Path(repo_path) / skills_path.strip("/")
            target_dir.mkdir(parents=True, exist_ok=True)

            for skill in skills_to_push:
                skill_dict = {
                    "name": skill.name,
                    "slug": skill.slug,
                    "description": skill.description,
                    "version": skill.version,
                    "triggers": skill.triggers or [],
                    "tags": skill.tags or [],
                    "required_tools": skill.required_tools or [],
                    "steps": skill.steps or [],
                }
                if skill.system_prompt:
                    skill_dict["system_prompt"] = skill.system_prompt

                file_path = target_dir / f"{skill.slug}.yaml"
                yaml_content = yaml.dump(skill_dict, default_flow_style=False, allow_unicode=True)
                async with aiofiles.open(file_path, "w") as f:
                    await f.write(yaml_content)
                pushed += 1

            if pushed > 0:
                try:
                    await self._git_commit_and_push(
                        repo_path,
                        f"Add {pushed} agent-generated skills from Podex",
                    )
                except Exception as e:
                    logger.warning("Failed to push new skills", error=str(e))

        return SyncResult(
            success=True,
            skills_added=pull_result.skills_added + pushed,
            skills_updated=pull_result.skills_updated,
            skills_removed=pull_result.skills_removed,
        )

    async def _git_commit_and_push(self, repo_path: str, message: str) -> None:
        """Commit changes and push to remote."""
        # Add all changes
        add_proc = await asyncio.create_subprocess_exec(
            "git",
            "add",
            "-A",
            cwd=repo_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await add_proc.communicate()

        # Commit
        commit_proc = await asyncio.create_subprocess_exec(
            "git",
            "commit",
            "-m",
            message,
            cwd=repo_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await commit_proc.communicate()

        if commit_proc.returncode != 0 and b"nothing to commit" not in stdout:
            raise Exception(f"Commit failed: {stderr.decode()}")  # noqa: TRY002, TRY003

        # Push
        push_proc = await asyncio.create_subprocess_exec(
            "git",
            "push",
            cwd=repo_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await push_proc.communicate()

        if push_proc.returncode != 0:
            raise Exception(f"Push failed: {stderr.decode()}")  # noqa: TRY002, TRY003

    async def _create_skill_from_data(
        self,
        user_id: str,
        repo_id: str,
        skill_data: dict[str, Any],
    ) -> UserSkill:
        """Create a UserSkill from parsed YAML data."""
        now = datetime.now(UTC)

        skill = UserSkill(
            id=str(uuid4()),
            user_id=user_id,
            name=skill_data["name"],
            slug=skill_data["slug"],
            description=skill_data["description"],
            version=skill_data.get("version", "1.0.0"),
            triggers=skill_data.get("triggers", []),
            tags=skill_data.get("tags", []),
            required_tools=skill_data.get("required_tools", []),
            steps=skill_data.get("steps", []),
            system_prompt=skill_data.get("system_prompt"),
            generated_by_agent=False,
            source_repository_id=repo_id,
            is_public=False,
            usage_count=0,
            created_at=now,
            updated_at=now,
        )

        self.db.add(skill)
        return skill

    async def _update_skill_from_data(
        self,
        skill: UserSkill,
        skill_data: dict[str, Any],
    ) -> None:
        """Update an existing UserSkill from parsed YAML data."""
        skill.name = skill_data["name"]
        skill.description = skill_data["description"]
        skill.version = skill_data.get("version", skill.version)
        skill.triggers = skill_data.get("triggers", [])
        skill.tags = skill_data.get("tags", [])
        skill.required_tools = skill_data.get("required_tools", [])
        skill.steps = skill_data.get("steps", [])
        skill.system_prompt = skill_data.get("system_prompt")
        skill.updated_at = datetime.now(UTC)

    async def _update_sync_log(
        self,
        sync_log: SkillSyncLog,
        success: bool,
        skills_added: int = 0,
        skills_updated: int = 0,
        skills_removed: int = 0,
        error: str | None = None,
    ) -> None:
        """Update a sync log entry with results."""
        sync_log.status = "success" if success else "failed"
        sync_log.skills_added = skills_added
        sync_log.skills_updated = skills_updated
        sync_log.skills_removed = skills_removed
        sync_log.error_message = error
        sync_log.completed_at = datetime.now(UTC)

        await self.db.commit()

    async def _update_repository_sync_status(
        self,
        repo_id: str,
        status: str,
        error: str | None = None,
    ) -> None:
        """Update repository sync status."""
        await self.db.execute(
            update(SkillRepository)
            .where(SkillRepository.id == repo_id)
            .values(
                last_synced_at=datetime.now(UTC),
                last_sync_status=status,
                last_sync_error=error,
            )
        )
        await self.db.commit()


async def run_sync(
    db: AsyncSession,
    repository_id: str,
    sync_log_id: str,
) -> SyncResult:
    """Run a sync operation for a repository.

    This is the entry point for background sync tasks.
    """
    # Get repository and sync log
    repo_query = select(SkillRepository).where(SkillRepository.id == repository_id)
    repo = (await db.execute(repo_query)).scalar_one_or_none()

    if not repo:
        return SyncResult(success=False, error="Repository not found")

    log_query = select(SkillSyncLog).where(SkillSyncLog.id == sync_log_id)
    sync_log = (await db.execute(log_query)).scalar_one_or_none()

    if not sync_log:
        return SyncResult(success=False, error="Sync log not found")

    # Run sync
    service = SkillSyncService(db)
    return await service.sync_repository(repo, sync_log)
