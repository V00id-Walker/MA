function quote(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function b64(value) {
  return [...Buffer.from(value, 'base64')];
}

function rc4(key, input) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
  }

  const output = [];
  let i = 0;
  j = 0;
  for (const char of input) {
    i = (i + 1) & 255;
    j = (j + state[i]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
    output.push(char ^ state[(state[i] + state[j]) & 255]);
  }
  return output;
}

const add8 = (n) => (c) => (c + n) & 255;
const sub8 = (n) => (c) => (c - n + 256) & 255;
const rotl8 = (n) => (c) => ((c << n) | (c >> (8 - n))) & 255;
const rotr8 = (n) => (c) => ((c >> n) | (c << (8 - n))) & 255;

function transform(input, seed, prefix, schedule) {
  const output = [];
  input.forEach((char, index) => {
    if (index < prefix.length) output.push(prefix[index] || 0);
    output.push(schedule[index % 10]((char ^ seed[index % 32]) & 255) & 255);
  });
  return output;
}

function generateMangafireVrf(input) {
  let value = [...Buffer.from(quote(input))];
  for (const [key, seed, prefix, schedule] of ROUNDS) {
    value = transform(rc4(b64(key), value), b64(seed), b64(prefix), schedule);
  }
  return Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const ROUNDS = [
  [
    'FgxyJUQDPUGSzwbAq/ToWn4/e8jYzvabE+dLMb1XU1o=',
    'yH6MXnMEcDVWO/9a6P9W92BAh1eRLVFxFlWTHUqQ474=',
    'l9PavRg=',
    [sub8(223), rotr8(4), rotr8(4), add8(234), rotr8(7), rotr8(2), rotr8(7), sub8(223), rotr8(7), rotr8(6)],
  ],
  [
    'CQx3CLwswJAnM1VxOqX+y+f3eUns03ulxv8Z+0gUyik=',
    'RK7y4dZ0azs9Uqz+bbFB46Bx2K9EHg74ndxknY9uknA=',
    'Ml2v7ag1Jg==',
    [add8(19), rotr8(7), add8(19), rotr8(6), add8(19), rotr8(1), add8(19), rotr8(6), rotr8(7), rotr8(4)],
  ],
  [
    'fAS+otFLkKsKAJzu3yU+rGOlbbFVq+u+LaS6+s1eCJs=',
    'rqr9HeTQOg8TlFiIGZpJaxcvAaKHwMwrkqojJCpcvoc=',
    'i/Va0UxrbMo=',
    [sub8(223), rotr8(1), add8(19), sub8(223), rotl8(2), sub8(223), add8(19), rotl8(1), rotl8(2), rotl8(1)],
  ],
  [
    'Oy45fQVK9kq9019+VysXVlz1F9S1YwYKgXyzGlZrijo=',
    '/4GPpmZXYpn5RpkP7FC/dt8SXz7W30nUZTe8wb+3xmU=',
    'WFjKAHGEkQM=',
    [add8(19), rotl8(1), rotl8(1), rotr8(1), add8(234), rotl8(1), sub8(223), rotl8(6), rotl8(4), rotl8(1)],
  ],
  [
    'aoDIdXezm2l3HrcnQdkPJTDT8+W6mcl2/02ewBHfPzg=',
    'wsSGSBXKWA9q1oDJpjtJddVxH+evCfL5SO9HZnUDFU8=',
    '5Rr27rWd',
    [rotr8(1), rotl8(1), rotl8(6), rotr8(1), rotl8(2), rotr8(4), rotl8(1), rotl8(1), sub8(223), rotl8(2)],
  ],
];

module.exports = { generateMangafireVrf };
