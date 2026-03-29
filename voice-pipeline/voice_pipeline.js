#!/usr/bin/env node
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function requireArg(args, key) {
  if (!args[key]) {
    console.error(`Missing required argument --${key}`);
    process.exit(1);
  }
  return args[key];
}

function readOpenAIKey() {
  const keyDir = process.env.OPENAI_API_KEY_DIR;
  if (!keyDir) throw new Error('OPENAI_API_KEY_DIR is not set');
  return fs.readFileSync(keyDir, 'utf8').trim();
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function postMultipart(url, { headers = {}, fields = {}, fileField }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (fileField) {
    const blob = await fs.openAsBlob(fileField.path);
    form.append(fileField.name, blob, path.basename(fileField.path));
  }
  const res = await fetch(url, { method: 'POST', headers, body: form });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function transcribeAudio({ audioPath, apiKey }) {
  return postMultipart('https://api.openai.com/v1/audio/transcriptions', {
    headers: { Authorization: `Bearer ${apiKey}` },
    fields: { model: 'whisper-1' },
    fileField: { name: 'file', path: audioPath },
  });
}

async function createTeachingReply({ transcript, apiKey, learnerName = 'the learner' }) {
  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.4,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'voice_coach_reply',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            transcript: { type: 'string' },
            conciseAssessment: { type: 'string' },
            correctionNeeded: { type: 'boolean' },
            userVersion: { type: 'string' },
            improvedVersion: { type: 'string' },
            explanation: { type: 'string' },
            replyText: { type: 'string' },
            nextPrompt: { type: 'string' },
            estimatedLevel: { type: 'string' }
          },
          required: ['transcript','conciseAssessment','correctionNeeded','userVersion','improvedVersion','explanation','replyText','nextPrompt','estimatedLevel']
        }
      }
    },
    messages: [
      {
        role: 'system',
        content: [
          'You are Luna, a warm English teacher for voice lessons.',
          'Always reply in English only.',
          'Be concise, supportive, and natural for spoken conversation.',
          'If the learner made a clear grammar or phrasing mistake, provide one gentle correction.',
          'The replyText must sound good when read aloud in TTS.',
          'The nextPrompt should be a short next question or instruction for continuing the lesson.',
          'Keep replyText under 120 words.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Learner name: ${learnerName}\nVoice transcript: ${transcript}`
      }
    ]
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('Missing model output');
  return JSON.parse(content);
}

async function runTts({ text, outputPath, voice = 'en-US-MichelleNeural', rate = '-5%', pitch = '+5%' }) {
  const scriptPath = path.resolve(__dirname, '../skills/edge-tts/scripts/tts-converter.js');
  await new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, text, '--voice', voice, '--rate', rate, '--pitch', pitch, '--output', outputPath], {
      stdio: 'inherit'
    });
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`TTS exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const audioPath = path.resolve(requireArg(args, 'audio'));
  const learnerName = args.name || 'Learner';
  const runId = args['message-id'] || path.basename(audioPath, path.extname(audioPath));
  const rootDir = path.resolve(args['root-dir'] || path.join(process.cwd(), 'voice-pipeline-data'));
  const voice = args.voice || 'en-US-MichelleNeural';

  const dirs = {
    inputs: path.join(rootDir, 'voice-inputs'),
    transcripts: path.join(rootDir, 'voice-transcripts'),
    replies: path.join(rootDir, 'voice-replies'),
    outputs: path.join(rootDir, 'voice-outputs'),
    runs: path.join(rootDir, 'runs')
  };
  await Promise.all(Object.values(dirs).map(ensureDir));

  const copiedInput = path.join(dirs.inputs, `${runId}${path.extname(audioPath)}`);
  await fsp.copyFile(audioPath, copiedInput);

  const apiKey = readOpenAIKey();
  const transcription = await transcribeAudio({ audioPath: copiedInput, apiKey });
  const transcript = transcription.text || String(transcription);
  const transcriptPath = path.join(dirs.transcripts, `${runId}.txt`);
  await fsp.writeFile(transcriptPath, transcript + '\n', 'utf8');

  const teaching = await createTeachingReply({ transcript, apiKey, learnerName });
  const replyJsonPath = path.join(dirs.replies, `${runId}.json`);
  await fsp.writeFile(replyJsonPath, JSON.stringify(teaching, null, 2) + '\n', 'utf8');

  const audioOut = path.join(dirs.outputs, `${runId}.mp3`);
  await runTts({ text: teaching.replyText, outputPath: audioOut, voice });

  const runSummary = {
    runId,
    learnerName,
    inputAudio: copiedInput,
    transcriptPath,
    replyJsonPath,
    outputAudio: audioOut,
    transcript,
    replyText: teaching.replyText,
    nextPrompt: teaching.nextPrompt,
    estimatedLevel: teaching.estimatedLevel,
    createdAt: new Date().toISOString()
  };
  const runPath = path.join(dirs.runs, `${runId}.json`);
  await fsp.writeFile(runPath, JSON.stringify(runSummary, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify(runSummary, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
