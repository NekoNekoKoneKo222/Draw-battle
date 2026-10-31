import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the exact pure decision function from the shipped browser file.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const match = source.match(/^  function chooseCardElement\([\s\S]*?^  }/m);
assert.ok(match, 'chooseCardElement exists in app.js');
const choose = runInNewContext(`(${match[0].trim()})`);
const example = {
  visualElement: 'water',
  elementScores: [{ id: 'water', score: .55 }],
  creatureScores: [{ id: 'cat', score: .01 }],
};

assert.equal(choose({ element: null, creature: { id: 'cat' } }, { element: 'water', saturation: .8 }, example), 'normal', 'A cat must not be forced into water by a classifier');
assert.equal(choose({ element: 'fire', creature: { id: 'cat' } }, { element: 'water', saturation: .8 }, example), 'fire', 'An explicit elemental name takes priority');
assert.equal(choose({ element: null, creature: null }, { element: 'dark', saturation: .08 }, example), 'normal', 'An ordinary monochrome drawing stays normal');
assert.equal(choose({ element: null, creature: null }, { element: 'water', saturation: .42 }, { ...example, creatureScores: [{ score: .7 }] }), 'normal', 'Recognizable animals stay normal even without name keywords');
assert.equal(choose({ element: null, creature: null }, { element: 'fire', saturation: .65 }, { ...example, visualElement: 'fire', elementScores: [{ score: .8 }] }), 'fire', 'A brightly colored elemental illustration can be elemental');
assert.equal(choose({ element: null, creature: null }, { element: 'water', saturation: .42 }, null), 'normal', 'An unavailable model must not force a color-based element');

console.log('Card type regression cases passed (6).');
