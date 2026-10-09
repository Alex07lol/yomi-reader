import { el } from '../utils/dom';

export interface SelectMenuOption {
  value: string;
  label: string;
}

export function renderSelectMenu(
  ariaLabel: string,
  value: string,
  options: SelectMenuOption[],
  onSelect: (value: string) => void,
  className = '',
  leadingLabel = '',
  disabled = false,
): HTMLElement {
  const selected = options.find(option => option.value === value) ?? options[0];
  const details = el('details', { className: `select-menu ${className}`.trim() });
  const valueLabel = el('span', { className: 'select-menu-value', text: selected?.label ?? '' });
  const trigger = el('summary', { className: `select-menu-trigger${disabled ? ' disabled' : ''}`, 'aria-label': ariaLabel, 'aria-disabled': String(disabled), tabindex: disabled ? '-1' : '0' },
    leadingLabel ? el('span', { className: 'select-menu-leading', text: leadingLabel }) : null,
    valueLabel,
    el('span', { className: 'select-menu-chevron', 'aria-hidden': 'true' }),
  );
  const menu = el('div', { className: 'select-menu-popover', role: 'listbox', 'aria-label': ariaLabel });
  const optionButtons = options.map(option => {
    const button = el('button', {
      type: 'button',
      className: `select-menu-option${option.value === selected?.value ? ' selected' : ''}`,
      role: 'option',
      'aria-selected': option.value === selected?.value ? 'true' : 'false',
      onclick: () => {
        valueLabel.textContent = option.label;
        optionButtons.forEach((item, index) => {
          const active = options[index].value === option.value;
          item.classList.toggle('selected', active);
          item.setAttribute('aria-selected', String(active));
        });
        details.open = false;
        onSelect(option.value);
      },
    }, option.label);
    return button;
  });
  optionButtons.forEach(button => menu.appendChild(button));
  details.append(trigger, menu);
  if (disabled) details.addEventListener('click', event => event.preventDefault());
  details.addEventListener('keydown', event => {
    if (event.key === 'Escape' && details.open) {
      details.open = false;
      trigger.focus();
    }
  });
  details.addEventListener('focusout', event => {
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && !details.contains(next)) details.open = false;
  });
  return details;
}
