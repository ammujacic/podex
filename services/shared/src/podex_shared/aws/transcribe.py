"""AWS Transcribe client for speech-to-text."""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

import aioboto3

logger = logging.getLogger(__name__)


@dataclass
class TranscriptionResult:
    """Result from speech-to-text transcription."""

    text: str
    confidence: float
    language: str
    duration_ms: int
    words: list[dict[str, Any]] = field(default_factory=list)
    is_final: bool = True
    job_name: str | None = None


@dataclass
class TranscriptionJobConfig:
    """Configuration for a transcription job."""

    job_name: str
    s3_uri: str
    output_bucket: str
    output_key: str
    language_code: str = "en-US"
    media_format: str = "webm"


class TranscribeClient:
    """AWS Transcribe client for speech-to-text operations."""

    def __init__(
        self,
        region: str = "us-east-1",
        endpoint_url: str | None = None,
    ):
        """Initialize Transcribe client.

        Args:
            region: AWS region
            endpoint_url: Optional endpoint URL (for LocalStack, not supported)
        """
        self.region = region
        self.endpoint_url = endpoint_url
        self._session = aioboto3.Session()

    async def start_transcription_job(
        self,
        config: TranscriptionJobConfig,
    ) -> dict[str, Any]:
        """Start an asynchronous transcription job.

        Args:
            config: Transcription job configuration

        Returns:
            Transcription job response
        """
        async with self._session.client(
            "transcribe",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        ) as client:
            response: dict[str, Any] = await client.start_transcription_job(
                TranscriptionJobName=config.job_name,
                LanguageCode=config.language_code,
                MediaFormat=config.media_format,
                Media={"MediaFileUri": config.s3_uri},
                OutputBucketName=config.output_bucket,
                OutputKey=config.output_key,
                Settings={
                    "ShowSpeakerLabels": False,
                    "ChannelIdentification": False,
                },
            )
            logger.info(f"Started transcription job: {config.job_name}")
            return response

    async def get_transcription_job(self, job_name: str) -> dict[str, Any]:
        """Get the status and result of a transcription job.

        Args:
            job_name: Name of the transcription job

        Returns:
            Transcription job details
        """
        async with self._session.client(
            "transcribe",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        ) as client:
            response: dict[str, Any] = await client.get_transcription_job(
                TranscriptionJobName=job_name,
            )
            return response

    async def wait_for_transcription(
        self,
        job_name: str,
        max_attempts: int = 60,
        delay_seconds: int = 5,
    ) -> TranscriptionResult | None:
        """Wait for a transcription job to complete.

        Args:
            job_name: Name of the transcription job
            max_attempts: Maximum polling attempts
            delay_seconds: Delay between attempts

        Returns:
            TranscriptionResult if successful, None if failed
        """
        for _ in range(max_attempts):
            response = await self.get_transcription_job(job_name)
            job = response["TranscriptionJob"]
            status = job["TranscriptionJobStatus"]

            if status == "COMPLETED":
                # Parse the transcript from the output
                transcript_uri = job.get("Transcript", {}).get("TranscriptFileUri")
                if transcript_uri:
                    return TranscriptionResult(
                        text="",  # Would need to fetch from S3
                        confidence=0.0,
                        language=job.get("LanguageCode", "en-US"),
                        duration_ms=0,
                        is_final=True,
                        job_name=job_name,
                    )

            elif status == "FAILED":
                logger.error(f"Transcription job failed: {job.get('FailureReason')}")
                return None

            await asyncio.sleep(delay_seconds)

        logger.error(f"Transcription job timed out: {job_name}")
        return None

    async def delete_transcription_job(self, job_name: str) -> None:
        """Delete a transcription job.

        Args:
            job_name: Name of the transcription job
        """
        async with self._session.client(
            "transcribe",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        ) as client:
            await client.delete_transcription_job(TranscriptionJobName=job_name)
            logger.info(f"Deleted transcription job: {job_name}")

    async def list_transcription_jobs(
        self,
        status: str | None = None,
        max_results: int = 100,
    ) -> list[dict[str, Any]]:
        """List transcription jobs.

        Args:
            status: Filter by status (QUEUED, IN_PROGRESS, FAILED, COMPLETED)
            max_results: Maximum number of results

        Returns:
            List of transcription job summaries
        """
        async with self._session.client(
            "transcribe",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        ) as client:
            kwargs: dict[str, Any] = {"MaxResults": max_results}
            if status:
                kwargs["Status"] = status

            response = await client.list_transcription_jobs(**kwargs)
            summaries: list[dict[str, Any]] = response.get("TranscriptionJobSummaries", [])
            return summaries


class MockTranscribeClient(TranscribeClient):
    """Mock Transcribe client for local development.

    Since AWS Transcribe is not supported in LocalStack,
    this mock provides placeholder responses for testing.
    """

    def __init__(self, **kwargs: Any):
        """Initialize mock client."""
        super().__init__(**kwargs)
        self._jobs: dict[str, dict[str, Any]] = {}

    async def start_transcription_job(
        self,
        config: TranscriptionJobConfig,
    ) -> dict[str, Any]:
        """Mock starting a transcription job."""
        job = {
            "TranscriptionJobName": config.job_name,
            "TranscriptionJobStatus": "COMPLETED",
            "LanguageCode": config.language_code,
            "MediaFormat": config.media_format,
            "Media": {"MediaFileUri": config.s3_uri},
            "Transcript": {
                "TranscriptFileUri": f"s3://{config.output_bucket}/{config.output_key}",
            },
        }
        self._jobs[config.job_name] = job
        logger.info(f"[MOCK] Started transcription job: {config.job_name}")
        return {"TranscriptionJob": job}

    async def get_transcription_job(self, job_name: str) -> dict[str, Any]:
        """Mock getting a transcription job."""
        job = self._jobs.get(
            job_name,
            {
                "TranscriptionJobName": job_name,
                "TranscriptionJobStatus": "COMPLETED",
            },
        )
        return {"TranscriptionJob": job}

    async def wait_for_transcription(
        self,
        job_name: str,
        _max_attempts: int = 60,
        _delay_seconds: int = 5,
    ) -> TranscriptionResult | None:
        """Mock waiting for transcription - returns immediately."""
        return TranscriptionResult(
            text="[Mock transcription - voice features in dev mode]",
            confidence=0.95,
            language="en-US",
            duration_ms=1000,
            is_final=True,
            job_name=job_name,
        )


def get_transcribe_client(
    region: str = "us-east-1",
    endpoint_url: str | None = None,
    use_mock: bool = False,
) -> TranscribeClient:
    """Get a Transcribe client instance.

    Args:
        region: AWS region
        endpoint_url: Optional endpoint URL
        use_mock: Use mock client for local development

    Returns:
        TranscribeClient or MockTranscribeClient
    """
    if use_mock or endpoint_url:
        # Use mock for LocalStack since Transcribe isn't supported
        return MockTranscribeClient(region=region, endpoint_url=endpoint_url)
    return TranscribeClient(region=region)
