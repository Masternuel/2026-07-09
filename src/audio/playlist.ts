import type { MusicTrack } from './musicManager';

// Assets stay local until their distribution rights have been cleared.
export const musicPlaylist: readonly MusicTrack[] = [
  { id: 'questions', title: 'Questions', artist: 'Tristam', src: '/audio/tracks/questions.mp3' },
  { id: 'venus-fly-trap', title: 'venus fly trap', artist: 'brakence', src: '/audio/tracks/venus-fly-trap.mp3' },
  { id: 'crossfire', title: 'Crossfire', artist: 'Stephen', src: '/audio/tracks/crossfire.mp3' },
  { id: 'monster', title: 'Monster', artist: 'Brooks', src: '/audio/tracks/monster.mp3' },
  { id: 'holding-on', title: 'Holding On (Rome In Silver Remix)', artist: 'Dabin feat. Lowell', src: '/audio/tracks/holding-on.mp3' },
  { id: 'ten', title: 'ten', artist: 'Fred again..', src: '/audio/tracks/ten.mp3' },
  { id: 'end-credits', title: 'End Credits', artist: 'EDEN', src: '/audio/tracks/end-credits.mp3' },
  { id: 'leaving', title: 'Leaving', artist: 'ILLENIUM', src: '/audio/tracks/leaving.mp3' },
  { id: 'masquerade', title: 'Masquerade', artist: 'Kai Wachi & YMIR', src: '/audio/tracks/masquerade.mp3' },
];
