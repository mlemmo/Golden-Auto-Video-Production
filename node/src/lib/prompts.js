// Seedance video prompts (promptNative, speechPronunciationGuide, prompt). The prompt text is part of each
// generation's duplicate-request fingerprint, so any change to it makes earlier requests look new.
import { trim, rtrim, lower, round, str } from './text.js';
import { seedanceRespell, SPEECH_PRONUNCIATION } from './speech.js';
import { title } from './price.js';

export const SPOKESPERSON_DEFAULT_DESCRIPTION = 'trustworthy friendly adult woman age 28–33, casual professional attire';

/** Number-to-text for the numbers in prompts (whole floats without ".0"). */
const num = (x) => String(x);

export function speechPronunciationGuide(speech) {
  const notes = [];
  for (const [word, say] of Object.entries(SPEECH_PRONUNCIATION)) if (lower(speech).includes(lower(word))) notes.push(`"${word}" is pronounced ${say}`);
  return notes.length ? 'Pronunciation: ' + notes.join('; ') + '. ' : '';
}

/**
 * Native-voice showroom walkaround (Seedance generate_audio): four wide shots around the whole car, the spokesperson
 * beside it, speaking the script; a short approved narration ($speechSeconds) leaves pan shots of the car at the end.
 * voiceReference: false; true/'voice' = a sample of her voice; 'speech' = the exact approved narration.
 */
/** The original background (the default setting); the scene library (src/lib/scenes.js) offers others. */
export const SHOWROOM_SETTING = 'a bright, upscale modern showroom with polished floors, soft even lighting and tall windows, with open space all around the car, not a representation of the dealership’s actual building';
const settingText = (setting) => rtrim(trim(str(setting ?? '') || SHOWROOM_SETTING), '.');

export function promptNative(v, speech, duration = 30, presenter = SPOKESPERSON_DEFAULT_DESCRIPTION, voiceReference = false, speechSeconds = null, respell = {}, setting = SHOWROOM_SETTING) {
  presenter = rtrim(trim(presenter), '.');
  speech = trim(speech.replaceAll('"', "'").replace(/[\t\n\v\f\r ]+/g, ' '));
  if (speech === '') throw new Error('Write the script the spokesperson will say.');
  const speakFrom = 0.5;
  const speakUntil = speechSeconds !== null ? Math.min(duration - 0.5, round(speakFrom + speechSeconds, 1)) : Math.max(4, duration - 2);
  const talkEnd = speechSeconds !== null && duration - speakUntil >= 3 ? Math.trunc(Math.min(duration - 2, Math.ceil(speakUntil + 0.5))) : duration;
  let panShots = [];
  if (talkEnd < duration) {
    const pan = (from, to, move) => `(${from}–${to} s): camera-only shot of the parked car alone, ${move}; the whole car stays in frame and in focus; the spokesperson is not in this shot and nobody speaks. `;
    if (duration - talkEnd >= 6) {
      const mid = num(round((talkEnd + duration) / 2));
      panShots = [pan(num(talkEnd), mid, 'a slow smooth camera orbit from the front three-quarter along the side of the car'),
        pan(mid, num(duration), 'a slow gentle push-in toward the front three-quarter, ending on a clean hero view of the car')];
    } else panShots = [pan(num(talkEnd), num(duration), 'a slow smooth camera orbit around the front three-quarter, ending on a clean hero view of the car')];
  }
  const t = (f) => num(round(talkEnd * f));
  const silentAfter = panShots.length
    ? 'At ' + num(speakUntil) + ' seconds she has finished speaking and says nothing more. '
    : speechSeconds !== null && speakUntil < duration - 1 ? 'At ' + num(speakUntil) + ' seconds she has finished speaking: from then until the end she does not talk at all, keeps her mouth closed with a warm smile, and simply gestures toward the car. ' : '';
  const count = ['', 'one', 'two'][panShots.length];
  return 'Create a ' + duration + '-second dealership walkaround video made of four wide shots, with synchronized spoken dialogue' + (panShots.length ? ', followed by ' + count + ' slow camera-only pan shot' + (panShots.length > 1 ? 's' : '') + ' of the car with no one speaking' : '') + '. ' +
    'Reference image 1 is the exact vehicle asset sheet showing its front, sides and rear; reference image 2 is the spokesperson; match their face, hair, body and outfit exactly. ' +
    (voiceReference === 'speech' ? 'Reference audio 1 is the exact recording of her speech for this video: she says exactly those words with that voice, at exactly the same pace and timing as the recording, starting at ' + num(speakFrom) + ' seconds; do not slow it down, stretch it or add pauses. Her lip movements follow that recording word for word. '
      : (voiceReference ? 'Reference audio 1 is the spokesperson\'s voice: match its timbre, accent, pitch and delivery exactly. ' : '')) +
    'Preserve the vehicle paint, trim, wheels, lamps and body exactly; do not invent equipment, badges or license plates, and do not repair cosmetic imperfections. The vehicle is parked and stationary throughout. ' +
    'Setting: ' + settingText(setting) + '. ' +
    'Framing rules for every shot: the car is the main subject and in sharp focus, and the entire car is visible from bumper to bumper with space around it, never cropped. Use a wide lens with the camera about seven meters away at chest height. ' +
    (panShots.length ? 'In shots 1–4 the spokesperson' : 'The spokesperson') + ' (' + presenter + ') stands or walks right beside the car, about one step from its body, shown full length from head to shoes, roughly half the height of the frame. She is never closer to the camera than the car, never blocks the view of the car, and never stands behind it or on its far side. ' +
    'Shot 1 (0–' + t(0.25) + ' s): wide front three-quarter view of the whole car; she stands beside the front fender, facing the camera, and begins speaking. ' +
    'Shot 2 (' + t(0.25) + '–' + t(0.5) + ' s): wide side profile of the whole car; she walks slowly along the side toward the rear, gesturing to the car. ' +
    'Shot 3 (' + t(0.5) + '–' + t(0.75) + ' s): wide rear three-quarter view of the whole car; she stands beside the rear corner, gesturing to the rear of the car. ' +
    'Shot 4 (' + t(0.75) + '–' + talkEnd + ' s): wide front three-quarter view of the whole car from the other side; she has walked around to the front corner and finishes speaking to the camera with a warm smile. ' +
    panShots.map((x, k) => 'Shot ' + (5 + k) + ' ' + x).join('') +
    'Clean cuts between shots; the camera is steady or moves slowly within each shot. ' +
    'Speech: she speaks to the camera' + (voiceReference === 'speech' ? ' while the recording plays, in that same voice and pace,' : ' throughout, in a warm, clear, natural, friendly American English voice, relaxed and unhurried, with a brief natural pause between sentences,') + ' like a real salesperson talking to one customer, not an announcer. Her lip movements match every word exactly, and her open-hand gestures toward the car match what she is saying. Her speech continues seamlessly across the cuts and finishes by ' + num(speakUntil) + ' seconds. ' + silentAfter +
    'She says exactly this, word for word, and nothing else: "' + seedanceRespell(speech, respell) + '" ' +
    'She says each sentence exactly once, in this order, and then stops: she never repeats a sentence, the price or the website, and never adds words of her own. ' +
    speechPronunciationGuide(speech) +
    'Audio: only her voice, clear, natural and close to the microphone, with no echo or reverb, over a soft quiet room tone' + (panShots.length ? '; during the pan shots only the soft room tone' : '') + '. No music, no other voices, no sound effects. ' +
    'Leave space at the bottom of the frame for captions added in post-production. No on-screen text of any kind: no captions, no watermark, no website address, no logo, no signage text, no license-plate text.';
}

/** Silent walkaround or dynamic sequence for the lip-sync method (no spoken script in the video). */
export function prompt(v, spoken, style = 'dynamic', duration = 15, presenter = SPOKESPERSON_DEFAULT_DESCRIPTION, setting = SHOWROOM_SETTING) {
  presenter = rtrim(trim(presenter), '.');
  if (style === 'showroom') return 'Create a ' + duration + '-second dealership walkaround video. Reference image 1 is the exact vehicle asset sheet showing its front, sides and rear; reference image 2 is the spokesperson; match their face, hair, body and outfit exactly. Preserve the vehicle paint, trim, wheels, lamps and body exactly; do not invent equipment or repair cosmetic imperfections. The vehicle is parked throughout. ' +
    'The spokesperson (' + presenter + ') begins at the rear three-quarter corner of the car on the side nearest the camera and walks slowly forward along that side to the front three-quarter corner, presenting the car. Never behind the car, never on its far side, never hidden by it. ' +
    'Throughout, the spokesperson is fully visible from head to at least the knees, faces the camera most of the time, and talks to the viewer continuously with natural mouth movement, warm expressions and open hand gestures toward the car. ' +
    'The stabilized camera tracks alongside at walking pace, slightly ahead of the spokesperson, keeping the face clearly visible, evenly lit and reasonably large in frame while the car stays recognizable beside them. One smooth continuous move; no hard cuts, no racing or drone shots. ' +
    (settingText(setting) === SHOWROOM_SETTING ? 'Use a bright, modern illustrative showroom, not a representation of the dealership’s actual building. ' : 'Setting: ' + settingText(setting) + '. ') + 'Leave space at the bottom of the frame for captions added in post-production. ' +
    'No on-screen text of any kind: no watermark, no website address, no logo, no signage text, no license-plate text.';
  return 'Create a polished 15-second vehicle advertisement with energetic Hyper Motion style choreography. ' +
    'Reference image 1 is the vehicle asset sheet, the authoritative visual identity. Reference image 2 is the recurring spokesperson. ' +
    'Preserve the exact vehicle year, body, paint, wheels, lights, trim and interior shown in reference 1. No invented equipment or upgraded condition. ' +
    'Vehicle: ' + title(v) + '; trim: ' + String(v.Trim ?? '') + '; exterior: ' + String(v.ExteriorColor ?? '') + '. ' +
    '0–4 seconds: stabilized ultra-low tracking shot of this vehicle rolling down a clean sunlit street. ' +
    '4–9 seconds: smooth matched transition to a slow macro glide across its actual dashboard, steering wheel and center console. Use leather only if visible in the reference. ' +
    '9–15 seconds: fast drone dolly-out revealing this car at golden hour outside a modern illustrative showroom. Do not imply this fictional setting is the dealership’s actual building. ' +
    'Continuous tracking within each scene; smooth transitions between scenes, no hard cuts. ' +
    'Spokesperson appears in a lower-left inset, away from vehicle details, matching reference image 2 exactly: ' + presenter + ', facing the camera and talking continuously with natural mouth movement and gestures. ' +
    'Keep important content central and inset from frame edges. No on-screen text of any kind: no watermark, no website address, no logo; accurate captions are added in post-production.';
}
