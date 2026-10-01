import shout, { greet } from './greeting.mjs';

export const welcome = (name) => `${greet(name)}!`;
export const loud = (name) => shout(name);
