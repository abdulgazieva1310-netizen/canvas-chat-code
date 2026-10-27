"""Public language capabilities; never expose provider credentials."""
from fastapi import APIRouter, Response
from pydantic import BaseModel

from ..services.ai_service import SUPPORTED_LANGUAGE_MATRIX, provider_supports_language

router = APIRouter()


class InterviewLanguageCapability(BaseModel):
    language: str
    available: bool
    releaseStatus: str
    provider: str
    model: str
    recognitionLocale: str
    synthesisLocale: str
    curatedFallback: bool
    unavailableReason: str | None


@router.get('/interview-languages', response_model=list[InterviewLanguageCapability], tags=['interviews'])
def interview_languages(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    capabilities = []
    for language, config in SUPPORTED_LANGUAGE_MATRIX.items():
        # English is usable through the curated bank even without AI credentials.
        available = language == 'English' or provider_supports_language(language)
        capabilities.append(InterviewLanguageCapability(
            language=language, available=available,
            releaseStatus='released' if language == 'English' else 'preview',
            provider=config['provider'], model=config['model'],
            recognitionLocale=config['recognition'], synthesisLocale=config['synthesis'],
            curatedFallback=language == 'English',
            unavailableReason=None if available else (
                'Russian preview requires server enablement and the allowlisted AI provider/model. '
                'Select English to continue.'),
        ))
    return capabilities
