import { describe, expect, it } from 'vitest';
import { extractMentions, tokenizeMentions } from './mentions';

describe('@mention parsing', () => {
  it('splits text into literal runs and mentions, preserving order', () => {
    expect(tokenizeMentions('hi @Alice_Writer and @bob!')).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', value: '@Alice_Writer', username: 'alice_writer' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: '@bob', username: 'bob' },
      { type: 'text', value: '!' },
    ]);
  });

  it('ignores tokens that are too short or use invalid characters', () => {
    // `@ab` is too short; `@bad-name` resolves to the valid `@bad` plus "-name".
    expect(tokenizeMentions('@ab @ok_1 @bad-name')).toEqual([
      { type: 'text', value: '@ab ' },
      { type: 'mention', value: '@ok_1', username: 'ok_1' },
      { type: 'text', value: ' ' },
      { type: 'mention', value: '@bad', username: 'bad' },
      { type: 'text', value: '-name' },
    ]);
  });

  it('extracts unique usernames in first-seen order', () => {
    expect(extractMentions('@bob hey @ALICE and @bob again')).toEqual(['bob', 'alice']);
    expect(extractMentions('no mentions here')).toEqual([]);
  });
});
