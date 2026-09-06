'use client';

import { useState } from 'react';

export const noteEmojiGroups = [
  { label: 'Mood', emojis: ['❤️','🩷','💜','🧡','💛','💚','💙','🤍','✨','⭐','🌟','🥹','😂','🤣','😗','😍','🥰','🤔','😴','😭','😤'] },
  { label: 'Animals', emojis: ['🦊','🐱','🐶','🐾','🐰','🦝','🐻','🐼','🦦','🦌','🐧','🐬','🐿️','🦉','🐒'] },
  { label: 'Food', emojis: ['🍜','🍣','🍱','🍙','🍛','🍤','🍡','🍰','🍮','🍦','🥐','🥞','☕','🍵','🍺','🍷','🥂','🍶','🥩','🍗'] },
  { label: 'Places', emojis: ['🏯','⛩️','🏰','🗼','🎡','🎢','🎠','🏛️','🖼️','🎨','📸','🌸','🍁','❄️','🌊','🌲','🏔️','🌋','🌃','🌅'] },
  { label: 'Stay & transport', emojis: ['🏨','🛏️','♨️','🚗','🚙','🚆','🚅','✈️','🚌','🚕','🚲','🚶','🚢','🚡','🛫','🛬'] },
  { label: 'Plan', emojis: ['📍','📌','✅','❌','⚠️','💡','🎯','💰','🛍️','🎁','⏰','🕒','📅','🧭','📝','🔖','💬','📎','🔗','🚩'] },
] as const;

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}

export function EmojiPicker({ onPick, disabled = false }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<(typeof noteEmojiGroups)[number]['label']>('Mood');

  const active = noteEmojiGroups.find((item) => item.label === group) ?? noteEmojiGroups[0];

  return (
    <div className="sharedEmojiPicker">
      <button
        className="emojiPickerToggle"
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-label="Open emoji picker"
        onClick={() => setOpen((value) => !value)}
      >
        😊 Emoji
      </button>

      {open && (
        <div className="sharedEmojiPickerPopover">
          <div className="sharedEmojiPickerTabs">
            {noteEmojiGroups.map((item) => (
              <button
                key={item.label}
                type="button"
                className={item.label === active.label ? 'active' : ''}
                onClick={() => setGroup(item.label)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="sharedEmojiPickerGrid">
            {active.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="sharedEmojiButton"
                onClick={() => onPick(emoji)}
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function insertEmojiAtSelection(
  textarea: HTMLTextAreaElement | null,
  currentText: string,
  emoji: string,
  maxLength: number
) {
  const start = textarea?.selectionStart ?? currentText.length;
  const end = textarea?.selectionEnd ?? start;
  const nextText = `${currentText.slice(0, start)}${emoji}${currentText.slice(end)}`.slice(0, maxLength);
  const nextCursor = Math.min(start + emoji.length, nextText.length);
  return { nextText, nextCursor };
}
