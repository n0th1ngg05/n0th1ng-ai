"""Custom exceptions for the speech runtime."""


class SpeechRuntimeError(Exception):
    """Base exception for speech runtime errors."""
    def __init__(self, message: str, code: str = "RUNTIME_ERROR"):
        self.message = message
        self.code = code
        super().__init__(self.message)


class ProviderError(SpeechRuntimeError):
    """Provider-related error."""
    def __init__(self, message: str, provider_id: str = ""):
        self.provider_id = provider_id
        super().__init__(message, "PROVIDER_ERROR")


class ModelError(SpeechRuntimeError):
    """Model-related error."""
    def __init__(self, message: str, model_id: str = ""):
        self.model_id = model_id
        super().__init__(message, "MODEL_ERROR")


class InferenceError(SpeechRuntimeError):
    """Inference-related error."""
    def __init__(self, message: str):
        super().__init__(message, "INFERENCE_ERROR")


class AudioError(SpeechRuntimeError):
    """Audio processing error."""
    def __init__(self, message: str):
        super().__init__(message, "AUDIO_ERROR")


class ValidationError(SpeechRuntimeError):
    """Input validation error."""
    def __init__(self, message: str):
        super().__init__(message, "VALIDATION_ERROR")


class DownloadError(SpeechRuntimeError):
    """Download-related error."""
    def __init__(self, message: str):
        super().__init__(message, "DOWNLOAD_ERROR")


class NotFoundError(SpeechRuntimeError):
    """Resource not found error."""
    def __init__(self, message: str):
        super().__init__(message, "NOT_FOUND")


class NotSupportedError(SpeechRuntimeError):
    """Operation not supported error."""
    def __init__(self, message: str):
        super().__init__(message, "NOT_SUPPORTED")
