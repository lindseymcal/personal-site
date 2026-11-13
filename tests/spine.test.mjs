import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashText, spineWidth, spineHeight, fallbackColor, spineTypeface, spineFontSize, spineStyle, STUDY_PALETTE,
  tuneCoverColor, homeSpineWidth, homeSpineHeight, coverFontSize,
} from '../src/spine.mjs';
import { contrastRatio, readableTextColor, hexToRgb, rgbToHex, relativeLuminance } from '../src/color.mjs';

test('hashText is stable and spreads values', () => {
  assert.equal(hashText('Persuasion'), hashText('Persuasion'));
  assert.notEqual(hashText('Persuasion'), hashText('Emma'));
});

test('spine width grows with pages and stays in range', () => {
  assert.ok(spineWidth(900) > spineWidth(200));
  assert.equal(spineWidth(0), 44);
  assert.equal(spineWidth(10), 26);
  assert.equal(spineWidth(5000), 96);
  // clearly proportional: an 800-page book is about three times as thick as a 100-page one
  assert.ok(spineWidth(800) >= 2.5 * spineWidth(100), `${spineWidth(800)} vs ${spineWidth(100)}`);
  assert.ok(spineWidth(100) <= 34 && spineWidth(800) >= 85);
  // linear between the clamps (about 0.085 px per page)
  assert.ok(Math.abs((spineWidth(600) - spineWidth(300)) - 25.5) <= 1);
  let prev = 0;
  for (let p = 1; p <= 1500; p += 10) { const w = spineWidth(p); assert.ok(w >= prev, `monotonic at ${p}`); prev = w; } // (0 pages means unknown, so it is skipped)
});

test('spine height is within the shelf and stable', () => {
  for (const title of ['A', 'Middlemarch', 'Moby-Dick']) {
    const h = spineHeight(500, title);
    assert.ok(h >= 228 && h <= 300, `height ${h}`);
    assert.equal(h, spineHeight(500, title));
  }
});

test('fallback color is a study color and deterministic', () => {
  const c = fallbackColor('Some Book');
  assert.ok(STUDY_PALETTE.includes(c));
  assert.equal(c, fallbackColor('Some Book'));
});

test('typeface rules by publication year', () => {
  assert.ok(spineTypeface(0, 'x').family.length > 0); // unknown year still gets a typeface
  assert.equal(spineTypeface(1600, 'x').family, 'Cinzel');
  assert.ok(['Playfair Display SC', 'IM Fell English SC'].includes(spineTypeface(1817, 'Persuasion').family));
  assert.ok(['Libre Baskerville', 'IM Fell English SC'].includes(spineTypeface(1871, 'Middlemarch').family));
  assert.deepEqual(spineTypeface(1999, 'x'), { family: 'Josefin Sans', caps: true });
  assert.equal(spineTypeface(1817, 'Persuasion').family, spineTypeface(1817, 'Persuasion').family);
});

test('font size fits: long titles shrink, within 10..19', () => {
  const short = spineFontSize('Emma', 44, 250);
  const long = spineFontSize('The Autobiography of Benjamin Franklin and Others', 44, 250);
  assert.ok(short > long);
  assert.ok(long >= 10 && short <= 19);
  assert.equal(spineFontSize('Emma', 20, 250), 10); // a very thin spine never goes below 10px
});

test('contrast math', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  assert.equal(contrastRatio('#336699', '#336699'), 1);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.equal(rgbToHex([255.4, 128, -3]), '#ff8000');
  assert.throws(() => hexToRgb('red'));
});

test('readableTextColor always reaches 4.5:1, even on mid-tones', () => {
  for (let v = 0; v <= 255; v += 5) {
    const bg = rgbToHex([v, v, v]);
    assert.ok(contrastRatio(bg, readableTextColor(bg)) >= 4.5, `gray ${bg}`);
  }
  for (const bg of ['#7a4c6b', '#c9a040', '#6f8a5b', '#b7837a', '#3f7a7a', '#8c5a78', '#777700', '#00aa66', '#cc3333']) {
    assert.ok(contrastRatio(bg, readableTextColor(bg)) >= 4.5, bg);
  }
});

test('spineStyle: override wins, then cover color, then fallback; text is readable', () => {
  const book = { title: 'Persuasion', spineTitle: 'Persuasion', pages: 249, pubYear: 1817, color: '' };
  assert.equal(spineStyle(book, '#112233').bg, '#112233');
  assert.equal(spineStyle({ ...book, color: '#AA5500' }, '#112233').bg, '#aa5500');
  assert.equal(spineStyle(book, undefined).bg, fallbackColor('Persuasion').toLowerCase());
  for (const hex of ['#112233', '#ccbb99', '#778877']) {
    const st = spineStyle(book, hex);
    assert.ok(contrastRatio(st.bg, st.text) >= 4.5);
  }
  const st = spineStyle(book, '#112233');
  assert.equal(st.width, spineWidth(249));
  assert.equal(st.height, spineHeight(249, 'Persuasion'));
});

test('tuneCoverColor softens extremes only', () => {
  assert.equal(tuneCoverColor([100, 120, 140]), '#64788c');
  assert.notEqual(tuneCoverColor([255, 255, 255]), '#ffffff');
  assert.notEqual(tuneCoverColor([0, 0, 0]), '#000000');
});

test('home shelf spine sizes', () => {
  assert.equal(homeSpineWidth(0), 22);
  assert.ok(homeSpineWidth(900) <= 34 && homeSpineWidth(30) >= 13);
  assert.ok(homeSpineWidth(800) > homeSpineWidth(100) + 10);
  const h = homeSpineHeight('Emma');
  assert.ok(h >= 86 && h <= 112);
  assert.ok(coverFontSize('Emma') > coverFontSize('The Autobiography of Benjamin Franklin'));
});
