import { describe, expect, it } from 'vitest';
import { renderMentionBody } from './community-shared';

describe('renderMentionBody', () => {
  it('renders plain text without any mention', () => {
    const fragment = renderMentionBody('just words');
    expect(fragment.textContent).toBe('just words');
    expect(fragment.querySelector?.('button')).toBeFalsy();
  });

  it('turns @username into a profile button, keeping surrounding text', () => {
    const host = document.createElement('div');
    host.appendChild(renderMentionBody('hi @bob_1 bye'));
    expect(host.textContent).toBe('hi @bob_1 bye');
    const button = host.querySelector('button.community-mention');
    expect(button?.textContent).toBe('@bob_1');
    expect(host.textContent?.includes('<')).toBe(false);
  });

  it('never injects markup from the body', () => {
    const host = document.createElement('div');
    host.appendChild(renderMentionBody('<img src=x onerror=alert(1)> @alice'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
