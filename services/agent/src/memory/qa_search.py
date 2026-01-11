"""RAG-based Q&A search for codebase understanding."""

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class CodeChunk:
    """A chunk of code for embedding and retrieval."""

    id: str
    file_path: str
    content: str
    start_line: int
    end_line: int
    chunk_type: str  # "function", "class", "block", "file_header"
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: list[float] | None = None


@dataclass
class SearchResult:
    """A search result from Q&A."""

    chunk: CodeChunk
    score: float
    highlights: list[str] = field(default_factory=list)


@dataclass
class QAResult:
    """Result of a Q&A query."""

    query: str
    answer: str
    sources: list[SearchResult]
    confidence: float
    generated_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "query": self.query,
            "answer": self.answer,
            "sources": [
                {
                    "file_path": s.chunk.file_path,
                    "start_line": s.chunk.start_line,
                    "end_line": s.chunk.end_line,
                    "content_preview": s.chunk.content[:200] + "..."
                    if len(s.chunk.content) > 200
                    else s.chunk.content,
                    "score": s.score,
                    "highlights": s.highlights,
                }
                for s in self.sources
            ],
            "confidence": self.confidence,
            "generated_at": self.generated_at.isoformat(),
        }


class CodebaseQASearch:
    """
    RAG-based Q&A search for codebase understanding.

    Features:
    - Chunk code into searchable segments
    - Generate embeddings for semantic search
    - Answer questions with code references
    - Learn from user corrections
    """

    # Chunking configuration
    MAX_CHUNK_LINES = 50
    MIN_CHUNK_LINES = 5
    OVERLAP_LINES = 3

    # File patterns
    CODE_EXTENSIONS = [".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".rb"]
    SKIP_DIRS = ["node_modules", "__pycache__", ".git", "dist", "build", "venv", ".venv"]

    def __init__(
        self,
        workspace_path: str,
        embedding_client: Any = None,
        llm_client: Any = None,
    ):
        self._workspace_path = workspace_path
        self._embedding_client = embedding_client
        self._llm_client = llm_client
        self._chunks: list[CodeChunk] = []
        self._corrections: list[dict[str, Any]] = []  # User corrections for learning
        self._indexed = False

    async def index_codebase(
        self,
        max_files: int = 200,
        force_reindex: bool = False,
    ) -> int:
        """
        Index the codebase for Q&A search.

        Args:
            max_files: Maximum files to index
            force_reindex: Force reindexing even if already indexed

        Returns:
            Number of chunks indexed
        """
        if self._indexed and not force_reindex:
            return len(self._chunks)

        self._chunks = []
        workspace = Path(self._workspace_path)
        files_processed = 0

        for ext in self.CODE_EXTENSIONS:
            for path in workspace.glob(f"**/*{ext}"):
                if any(skip in path.parts for skip in self.SKIP_DIRS):
                    continue

                chunks = await self._chunk_file(path)
                self._chunks.extend(chunks)
                files_processed += 1

                if files_processed >= max_files:
                    break

            if files_processed >= max_files:
                break

        # Generate embeddings if client available
        if self._embedding_client:
            await self._generate_embeddings()

        self._indexed = True
        logger.info(
            "codebase_indexed",
            files=files_processed,
            chunks=len(self._chunks),
        )

        return len(self._chunks)

    async def _chunk_file(self, file_path: Path) -> list[CodeChunk]:
        """Chunk a file into searchable segments."""
        chunks = []

        try:
            content = file_path.read_text()
            lines = content.split("\n")
            relative_path = str(file_path.relative_to(self._workspace_path))

            # Try to chunk by semantic units (functions, classes)
            semantic_chunks = self._extract_semantic_chunks(content, relative_path)

            if semantic_chunks:
                chunks.extend(semantic_chunks)
            else:
                # Fall back to sliding window chunking
                chunks.extend(self._sliding_window_chunk(lines, relative_path))

        except Exception as e:
            logger.warning("file_chunking_failed", file=str(file_path), error=str(e))

        return chunks

    def _extract_semantic_chunks(self, content: str, file_path: str) -> list[CodeChunk]:
        """Extract semantic chunks (functions, classes) from code."""
        chunks = []
        lines = content.split("\n")

        # Python patterns
        if file_path.endswith(".py"):
            # Find function and class definitions
            patterns = [
                (r"^(async\s+)?def\s+\w+", "function"),
                (r"^class\s+\w+", "class"),
            ]

            current_start = 0
            for i, line in enumerate(lines):
                for pattern, chunk_type in patterns:
                    if re.match(pattern, line):
                        # Save previous chunk if exists
                        if i > current_start:
                            chunk_content = "\n".join(lines[current_start:i])
                            if len(chunk_content.strip()) > 50:
                                chunks.append(
                                    self._create_chunk(
                                        file_path=file_path,
                                        content=chunk_content,
                                        start_line=current_start + 1,
                                        end_line=i,
                                        chunk_type="block",
                                    )
                                )

                        # Find end of this definition
                        end_line = self._find_block_end(lines, i)
                        chunk_content = "\n".join(lines[i : end_line + 1])

                        chunks.append(
                            self._create_chunk(
                                file_path=file_path,
                                content=chunk_content,
                                start_line=i + 1,
                                end_line=end_line + 1,
                                chunk_type=chunk_type,
                            )
                        )

                        current_start = end_line + 1
                        break

        # TypeScript/JavaScript patterns
        elif file_path.endswith((".ts", ".tsx", ".js", ".jsx")):
            patterns = [
                (r"^(export\s+)?(async\s+)?function\s+\w+", "function"),
                (r"^(export\s+)?class\s+\w+", "class"),
                (r"^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(", "function"),
            ]

            for i, line in enumerate(lines):
                for pattern, chunk_type in patterns:
                    if re.match(pattern, line.strip()):
                        # Find the matching closing brace
                        end_line = self._find_brace_block_end(lines, i)
                        if end_line > i:
                            chunk_content = "\n".join(lines[i : end_line + 1])
                            chunks.append(
                                self._create_chunk(
                                    file_path=file_path,
                                    content=chunk_content,
                                    start_line=i + 1,
                                    end_line=end_line + 1,
                                    chunk_type=chunk_type,
                                )
                            )
                        break

        return chunks

    def _find_block_end(self, lines: list[str], start: int) -> int:
        """Find end of a Python indented block."""
        if start >= len(lines):
            return start

        # Get base indentation
        base_indent = len(lines[start]) - len(lines[start].lstrip())
        end = start

        for i in range(start + 1, len(lines)):
            line = lines[i]
            if line.strip() == "":
                continue

            current_indent = len(line) - len(line.lstrip())
            if current_indent <= base_indent and line.strip():
                break
            end = i

        return min(end, start + self.MAX_CHUNK_LINES)

    def _find_brace_block_end(self, lines: list[str], start: int) -> int:
        """Find end of a brace-delimited block."""
        brace_count = 0
        started = False

        for i in range(start, min(start + self.MAX_CHUNK_LINES, len(lines))):
            for char in lines[i]:
                if char == "{":
                    brace_count += 1
                    started = True
                elif char == "}":
                    brace_count -= 1

            if started and brace_count == 0:
                return i

        return min(start + self.MAX_CHUNK_LINES, len(lines) - 1)

    def _sliding_window_chunk(self, lines: list[str], file_path: str) -> list[CodeChunk]:
        """Chunk file using sliding window."""
        chunks = []
        total_lines = len(lines)

        i = 0
        while i < total_lines:
            end = min(i + self.MAX_CHUNK_LINES, total_lines)
            chunk_content = "\n".join(lines[i:end])

            if len(chunk_content.strip()) > 50:
                chunks.append(
                    self._create_chunk(
                        file_path=file_path,
                        content=chunk_content,
                        start_line=i + 1,
                        end_line=end,
                        chunk_type="block",
                    )
                )

            i = end - self.OVERLAP_LINES

        return chunks

    def _create_chunk(
        self,
        file_path: str,
        content: str,
        start_line: int,
        end_line: int,
        chunk_type: str,
    ) -> CodeChunk:
        """Create a code chunk with unique ID."""
        chunk_id = hashlib.md5(f"{file_path}:{start_line}:{end_line}".encode()).hexdigest()[:12]

        return CodeChunk(
            id=chunk_id,
            file_path=file_path,
            content=content,
            start_line=start_line,
            end_line=end_line,
            chunk_type=chunk_type,
        )

    async def _generate_embeddings(self) -> None:
        """Generate embeddings for all chunks."""
        if not self._embedding_client:
            return

        batch_size = 20
        for i in range(0, len(self._chunks), batch_size):
            batch = self._chunks[i : i + batch_size]
            texts = [chunk.content for chunk in batch]

            try:
                embeddings = await self._embedding_client.embed(texts)
                for chunk, embedding in zip(batch, embeddings):
                    chunk.embedding = embedding
            except Exception as e:
                logger.error("embedding_generation_failed", error=str(e))

    async def search(
        self,
        query: str,
        top_k: int = 5,
    ) -> list[SearchResult]:
        """
        Search for relevant code chunks.

        Args:
            query: Search query
            top_k: Number of results to return

        Returns:
            List of search results
        """
        if not self._indexed:
            await self.index_codebase()

        results = []

        if self._embedding_client and any(c.embedding for c in self._chunks):
            # Semantic search
            try:
                query_embedding = await self._embedding_client.embed([query])
                results = self._semantic_search(query_embedding[0], top_k)
            except Exception as e:
                logger.warning("semantic_search_failed", error=str(e))
                results = self._keyword_search(query, top_k)
        else:
            # Keyword search fallback
            results = self._keyword_search(query, top_k)

        return results

    def _semantic_search(
        self,
        query_embedding: list[float],
        top_k: int,
    ) -> list[SearchResult]:
        """Perform semantic search using embeddings."""
        import math

        def cosine_similarity(a: list[float], b: list[float]) -> float:
            dot_product = sum(x * y for x, y in zip(a, b))
            norm_a = math.sqrt(sum(x * x for x in a))
            norm_b = math.sqrt(sum(x * x for x in b))
            return dot_product / (norm_a * norm_b) if norm_a * norm_b > 0 else 0

        scored = []
        for chunk in self._chunks:
            if chunk.embedding:
                score = cosine_similarity(query_embedding, chunk.embedding)
                scored.append((chunk, score))

        scored.sort(key=lambda x: x[1], reverse=True)

        return [SearchResult(chunk=chunk, score=score) for chunk, score in scored[:top_k]]

    def _keyword_search(self, query: str, top_k: int) -> list[SearchResult]:
        """Perform keyword-based search."""
        query_terms = set(query.lower().split())
        scored = []

        for chunk in self._chunks:
            content_lower = chunk.content.lower()

            # Count term matches
            matches = sum(1 for term in query_terms if term in content_lower)

            if matches > 0:
                # Score based on match ratio and chunk type
                score = matches / len(query_terms)
                if chunk.chunk_type in ["function", "class"]:
                    score *= 1.2  # Boost semantic chunks

                # Find highlights
                highlights = []
                for term in query_terms:
                    if term in content_lower:
                        idx = content_lower.find(term)
                        start = max(0, idx - 20)
                        end = min(len(chunk.content), idx + len(term) + 20)
                        highlights.append(f"...{chunk.content[start:end]}...")

                scored.append(
                    SearchResult(
                        chunk=chunk,
                        score=score,
                        highlights=highlights[:3],
                    )
                )

        scored.sort(key=lambda x: x.score, reverse=True)
        return scored[:top_k]

    async def ask(
        self,
        question: str,
        top_k: int = 5,
    ) -> QAResult:
        """
        Answer a question about the codebase.

        Args:
            question: The question to answer
            top_k: Number of sources to consider

        Returns:
            QAResult with answer and sources
        """
        # Search for relevant chunks
        search_results = await self.search(question, top_k=top_k)

        if not search_results:
            return QAResult(
                query=question,
                answer="I couldn't find relevant code to answer this question. "
                "Try rephrasing or asking about specific files or functions.",
                sources=[],
                confidence=0.0,
            )

        # Build context from search results
        context_parts = []
        for i, result in enumerate(search_results):
            context_parts.append(
                f"[Source {i + 1}] {result.chunk.file_path}:{result.chunk.start_line}\n"
                f"```\n{result.chunk.content[:1000]}\n```\n"
            )

        context = "\n".join(context_parts)

        # Generate answer using LLM
        if self._llm_client:
            prompt = f"""Based on the following code snippets, answer the question.

Code Context:
{context}

Question: {question}

Provide a clear, concise answer. Reference specific files and line numbers when relevant.
If you're not sure, say so.

Answer:"""

            try:
                answer = await self._llm_client.generate(prompt=prompt, max_tokens=500)
                confidence = min(0.9, 0.5 + (search_results[0].score * 0.5))
            except Exception as e:
                logger.error("qa_generation_failed", error=str(e))
                answer = self._generate_simple_answer(question, search_results)
                confidence = 0.3
        else:
            answer = self._generate_simple_answer(question, search_results)
            confidence = 0.5

        return QAResult(
            query=question,
            answer=answer,
            sources=search_results,
            confidence=confidence,
        )

    def _generate_simple_answer(
        self,
        _question: str,
        results: list[SearchResult],
    ) -> str:
        """Generate a simple answer without LLM."""
        if not results:
            return "No relevant code found."

        answer_parts = [f"Found {len(results)} relevant code sections:\n"]

        for i, result in enumerate(results[:3]):
            chunk = result.chunk
            answer_parts.append(
                f"{i + 1}. `{chunk.file_path}` (lines {chunk.start_line}-{chunk.end_line})"
            )
            if result.highlights:
                answer_parts.append(f"   Match: {result.highlights[0]}")

        return "\n".join(answer_parts)

    def add_correction(
        self,
        question: str,
        original_answer: str,
        corrected_answer: str,
        relevant_files: list[str] | None = None,
    ) -> None:
        """
        Add a user correction to improve future answers.

        Args:
            question: The original question
            original_answer: The answer that was corrected
            corrected_answer: The correct answer
            relevant_files: Files that are relevant to this Q&A
        """
        self._corrections.append(
            {
                "question": question,
                "original_answer": original_answer,
                "corrected_answer": corrected_answer,
                "relevant_files": relevant_files or [],
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

        logger.info(
            "qa_correction_added",
            question=question[:50],
            corrections_count=len(self._corrections),
        )


# Factory function
def create_qa_search(
    workspace_path: str,
    embedding_client: Any = None,
    llm_client: Any = None,
) -> CodebaseQASearch:
    """Create a Q&A search instance for a workspace."""
    return CodebaseQASearch(workspace_path, embedding_client, llm_client)
