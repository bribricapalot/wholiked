import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { parseTikTokExport, sampleForGame } from './tiktokExport';

// Shaped like TikTok's JSON export (keys as seen in real exports; the parser doesn't depend on them).
const exportJson = {
  Activity: {
    'Like List': {
      ItemFavoriteList: [
        { Date: '2025-03-01 10:00:00', Link: 'https://www.tiktokv.com/share/video/7300000000000000001/' },
        { Date: '2025-04-01 10:00:00', Link: 'https://www.tiktokv.com/share/video/7300000000000000002/' },
        { Date: '2025-04-01 10:00:00', Link: 'https://www.tiktokv.com/share/video/7300000000000000002/' }, // dup
      ],
    },
    'Favorite Videos': {
      FavoriteVideoList: [{ Date: '2025-01-01 10:00:00', Link: 'https://www.tiktokv.com/share/video/7300000000000000003/' }],
    },
    'Video Browsing History': {
      VideoList: [{ Date: '2025-05-01 10:00:00', Link: 'https://www.tiktokv.com/share/video/7399999999999999999/' }],
    },
  },
  'Direct Messages': {
    'Chat History': { ChatHistory: { 'Chat History with liker123:': [{ Content: 'https://www.tiktokv.com/share/video/7388888888888888888/' }] } },
  },
};

const exportTxt = `Like List:

Date: 2025-04-01 10:00:00
Link: https://www.tiktokv.com/share/video/7300000000000000002/

Date: 2025-03-01 10:00:00
Link: https://www.tiktokv.com/share/video/7300000000000000001/

Video Browsing History:

Date: 2025-05-01 10:00:00
Link: https://www.tiktokv.com/share/video/7399999999999999999/
`;

const file = (name: string, data: Uint8Array | string) => new File([typeof data === 'string' ? data : new Uint8Array(data)], name);

test('JSON export: likes + favourites, newest first, ignores history and DMs', async () => {
  const r = await parseTikTokExport(file('user_data_tiktok.json', JSON.stringify(exportJson)));
  assert.deepEqual(r.likes.map((i) => i.videoId), ['7300000000000000002', '7300000000000000001']);
  assert.deepEqual(r.favorites.map((i) => i.videoId), ['7300000000000000003']);
  const all = [...r.likes, ...r.favorites, ...r.reposts].map((i) => i.videoId);
  assert.ok(!all.includes('7399999999999999999'), 'watch history leaked');
  assert.ok(!all.includes('7388888888888888888'), 'DM link leaked');
});

test('TXT export', async () => {
  const r = await parseTikTokExport(file('user_data.txt', exportTxt));
  assert.deepEqual(r.likes.map((i) => i.videoId), ['7300000000000000002', '7300000000000000001']);
  assert.equal(r.favorites.length, 0);
});

test('ZIP containing the JSON', async () => {
  const zip = zipSync({ 'TikTok_Data/user_data_tiktok.json': strToU8(JSON.stringify(exportJson)), 'readme.pdf': new Uint8Array([1, 2]) });
  const r = await parseTikTokExport(file('TikTok_Data.zip', zip));
  assert.equal(r.likes.length, 2);
});

test('sample takes at most max items from the recent window', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ videoId: String(i), url: `u${i}`, date: null }));
  const s = sampleForGame(items, 10, 20);
  assert.equal(s.length, 10);
  assert.ok(s.every((u) => Number(u.slice(1)) < 20));
});
