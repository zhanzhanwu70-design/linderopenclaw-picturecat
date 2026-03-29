# Simple Asynchronous Voice Pipeline

This is a small MVP pipeline for Luna's Discord voice teaching flow.

## What it does

1. takes a Discord voice/audio file
2. copies it into a predictable workspace folder
3. transcribes it with OpenAI Whisper
4. generates an English-teacher reply with correction logic
5. synthesizes a spoken reply with Edge TTS
6. writes all artifacts to disk

## Output structure

```text
voice-pipeline-data/
  voice-inputs/
  voice-transcripts/
  voice-replies/
  voice-outputs/
  runs/
```

## Requirements

- `OPENAI_API_KEY_DIR` must point to a file containing a valid OpenAI API key
- Node.js 18+
- Edge TTS dependencies installed in `skills/edge-tts/scripts`

## Example usage

```bash
node voice-pipeline/voice_pipeline.js \
  --audio /path/to/input.ogg \
  --message-id 1487800000000 \
  --name Linder \
  --voice en-US-MichelleNeural
```

## What gets produced

For each run:
- copied input audio
- transcript text file
- structured teaching reply JSON
- MP3 spoken reply
- run summary JSON

## Notes

This MVP does **not** auto-send the output back to Discord by itself.
It is the local orchestration core.

To make it fully automatic, the next step is to connect this script to:
- Discord attachment intake
- automatic message sending after output generation

## Recommended next extension

Add a thin wrapper that:
- receives Discord attachment metadata
- runs this script
- sends `voice-outputs/<message-id>.mp3` plus reply text back to Discord
