"""Text-to-Speech via Google Cloud TTS.

Returns MP3 audio bytes for a natural female voice (Chirp3-HD by default).
If TTS isn't configured/available, the route returns 503 and the frontend
falls back to the browser's built-in speechSynthesis voice automatically.
"""
from functools import lru_cache
from .config import get_settings

settings = get_settings()


@lru_cache
def _client():
    # Imported lazily so the app still boots if the lib/credentials are absent.
    from google.cloud import texttospeech
    return texttospeech.TextToSpeechClient()


def synthesize(text: str) -> bytes:
    from google.cloud import texttospeech

    client = _client()
    synthesis_input = texttospeech.SynthesisInput(text=text[:1500])
    voice = texttospeech.VoiceSelectionParams(
        language_code=settings.tts_language_code,
        name=settings.tts_voice,
    )
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=1.0,
    )
    resp = client.synthesize_speech(
        input=synthesis_input, voice=voice, audio_config=audio_config
    )
    return resp.audio_content
