'use client';

import { useEffect } from 'react';
import { translateText, type Locale } from '@/lib/i18n';

const ATTRIBUTES = ['placeholder', 'aria-label', 'title'] as const;

export function AutoTranslate({ locale }: { locale: Locale }) {
  useEffect(() => {
    if (locale !== 'zh-TW') {
      document.documentElement.lang = 'en';
      return;
    }

    document.documentElement.lang = 'zh-Hant';
    let translating = false;

    const translateElement = (element: Element) => {
      for (const attribute of ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        const translated = translateText(locale, value);
        if (translated !== value) element.setAttribute(attribute, translated);
      }

      for (const node of Array.from(element.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const raw = node.textContent ?? '';
        const leading = raw.match(/^\s*/)?.[0] ?? '';
        const trailing = raw.match(/\s*$/)?.[0] ?? '';
        const clean = raw.trim();
        if (!clean) continue;
        const translated = translateText(locale, clean);
        if (translated !== clean) node.textContent = `${leading}${translated}${trailing}`;
      }
    };

    const translateTree = (root: ParentNode) => {
      if (root instanceof Element) translateElement(root);
      root.querySelectorAll('*').forEach(translateElement);
    };

    const runTranslate = (root: ParentNode = document.body) => {
      if (translating) return;
      translating = true;
      try {
        translateTree(root);
      } finally {
        translating = false;
      }
    };

    runTranslate();
    const timers = [
      window.setTimeout(() => runTranslate(), 0),
      window.setTimeout(() => runTranslate(), 150),
      window.setTimeout(() => runTranslate(), 600),
      window.setTimeout(() => runTranslate(), 1500),
    ];

    const observer = new MutationObserver((mutations) => {
      if (translating) return;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          if (parent) runTranslate(parent);
          continue;
        }

        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (target instanceof Element) runTranslate(target);
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const parent = node.parentElement;
            if (parent) runTranslate(parent);
          } else if (node instanceof Element) {
            runTranslate(node);
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });

    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [locale]);

  return null;
}
