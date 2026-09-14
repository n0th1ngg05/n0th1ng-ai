"""Voice profile management."""
import asyncio
from typing import Optional, Any
from dataclasses import dataclass, field
from datetime import datetime

from storage.profiles import ProfileStorage
from runtime.logger import get_logger
from runtime.exceptions import NotFoundError, ValidationError
from utils.validation import validate_profile
from utils.helpers import generate_id

logger = get_logger("voice_profiles")


@dataclass
class VoiceProfile:
    """Voice profile configuration."""
    id: str
    name: str
    provider_id: str
    model_id: str
    voice_id: str
    speed: float = 1.0
    pitch: float = 1.0
    temperature: float = 0.7
    volume: float = 1.0
    emotion: str = "neutral"
    language: str = "en"
    is_default: bool = False
    is_builtin: bool = False
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "provider_id": self.provider_id,
            "model_id": self.model_id,
            "voice_id": self.voice_id,
            "speed": self.speed,
            "pitch": self.pitch,
            "temperature": self.temperature,
            "volume": self.volume,
            "emotion": self.emotion,
            "language": self.language,
            "is_default": self.is_default,
            "is_builtin": self.is_builtin,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "VoiceProfile":
        return cls(
            id=data["id"],
            name=data["name"],
            provider_id=data["provider_id"],
            model_id=data["model_id"],
            voice_id=data["voice_id"],
            speed=data.get("speed", 1.0),
            pitch=data.get("pitch", 1.0),
            temperature=data.get("temperature", 0.7),
            volume=data.get("volume", 1.0),
            emotion=data.get("emotion", "neutral"),
            language=data.get("language", "en"),
            is_default=data.get("is_default", False),
            is_builtin=data.get("is_builtin", False),
            created_at=datetime.fromisoformat(data["created_at"]) if "created_at" in data else datetime.utcnow(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if "updated_at" in data else datetime.utcnow(),
        )


class ProfileManager:
    """Manages voice profiles."""

    def __init__(self):
        self._storage = ProfileStorage()
        self._builtin_profiles: list[VoiceProfile] = []

    def register_builtin(self, profile: VoiceProfile) -> None:
        """Register a built-in profile."""
        profile.is_builtin = True
        self._builtin_profiles.append(profile)

    async def initialize(self) -> None:
        """Initialize built-in profiles."""
        for profile in self._builtin_profiles:
            existing = await asyncio.to_thread(self._storage.load, profile.id)
            if not existing:
                await asyncio.to_thread(self._storage.save, profile.id, profile.to_dict())
                logger.info(f"Initialized built-in profile: {profile.name}")

    async def create_profile(self, name: str, provider_id: str, model_id: str, voice_id: str, **kwargs) -> VoiceProfile:
        """Create a new voice profile."""
        data = {
            "name": name,
            "provider_id": provider_id,
            "model_id": model_id,
            "voice_id": voice_id,
            **kwargs,
        }
        validate_profile(data)
        profile = VoiceProfile(id=generate_id(), **data)
        await asyncio.to_thread(self._storage.save, profile.id, profile.to_dict())
        logger.info(f"Created profile: {profile.name}")
        return profile

    async def get_profile(self, profile_id: str) -> Optional[VoiceProfile]:
        """Get a profile by ID."""
        data = await asyncio.to_thread(self._storage.load, profile_id)
        if data:
            return VoiceProfile.from_dict(data)
        return None

    async def get_default(self) -> Optional[VoiceProfile]:
        """Get the default profile."""
        data = await asyncio.to_thread(self._storage.get_default)
        if data:
            return VoiceProfile.from_dict(data)
        return None

    async def list_profiles(self) -> list[VoiceProfile]:
        """List all profiles."""
        data_list = await asyncio.to_thread(self._storage.list_all)
        return [VoiceProfile.from_dict(d) for d in data_list]

    async def update_profile(self, profile_id: str, updates: dict[str, Any]) -> VoiceProfile:
        """Update a profile."""
        profile = await self.get_profile(profile_id)
        if not profile:
            raise NotFoundError(f"Profile {profile_id} not found")
        if profile.is_builtin and "is_builtin" in updates:
            del updates["is_builtin"]
        for key, value in updates.items():
            if hasattr(profile, key):
                setattr(profile, key, value)
        profile.updated_at = datetime.utcnow()
        await asyncio.to_thread(self._storage.save, profile_id, profile.to_dict())
        return profile

    async def delete_profile(self, profile_id: str) -> None:
        """Delete a profile."""
        profile = await self.get_profile(profile_id)
        if not profile:
            raise NotFoundError(f"Profile {profile_id} not found")
        if profile.is_builtin:
            raise ValidationError("Cannot delete built-in profile")
        await asyncio.to_thread(self._storage.delete, profile_id)
        logger.info(f"Deleted profile: {profile_id}")
