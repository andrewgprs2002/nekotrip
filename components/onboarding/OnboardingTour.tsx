'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type OnboardingPage = 'home' | 'wishlist' | 'trip';

interface Step {
  target: string;
  title: string;
  body: string;
}

const STORAGE_PREFIX = 'nekotrip_onboarding_v1_';
const PAGES: OnboardingPage[] = ['home', 'wishlist', 'trip'];

const stepsByPage: Record<OnboardingPage, Step[]> = {
  home: [
    {
      target: '[data-onboarding="home-create-trip"]',
      title: 'Create your first Trip',
      body: 'Give the trip a name and optional travel dates. You can adjust the dates later.',
    },
    {
      target: '[data-onboarding="home-wishlist"]',
      title: 'Or start with Wishlist',
      body: 'Not ready to build the itinerary yet? Save interesting places first and move them into a Trip later.',
    },
  ],
  wishlist: [
    {
      target: '[data-onboarding="wishlist-search"]',
      title: 'Save places you are interested in',
      body: 'Search Google Places, choose a folder, category and rating, then save it to your Wishlist.',
    },
    {
      target: '[data-onboarding="wishlist-trip-actions"]',
      title: 'Turn ideas into an itinerary',
      body: 'Select several saved places, add them to an existing Trip, or create a new Trip from the selection.',
    },
    {
      target: '[data-onboarding="wishlist-collections"]',
      title: 'Plan together when you want',
      body: 'Switch between your private Wishlist and Shared Wishlists. Shared collections support collaborators and group ratings.',
    },
  ],
  trip: [
    {
      target: '[data-onboarding="trip-add-place"]',
      title: 'Build the itinerary',
      body: 'Search for a place, assign a day and category, then add it to this Trip.',
    },
    {
      target: '[data-onboarding="trip-days"]',
      title: 'Organize each day',
      body: 'Filter by day, move places between days, set stay time, and change the stop order.',
    },
    {
      target: '[data-onboarding="trip-route"]',
      title: 'Let NekoTrip calculate the route',
      body: 'Choose a day to see its route, travel time and distance. You can also set lodging endpoints and route preferences.',
    },
    {
      target: '[data-onboarding="trip-collaboration"]',
      title: 'Invite your travel partners',
      body: 'Members, sharing, profile and Trip settings live here. Collaborators can plan together in realtime.',
    },
  ],
};

function pageStorageKey(page: OnboardingPage) {
  return `${STORAGE_PREFIX}${page}`;
}

export function resetNekoTripOnboarding() {
  if (typeof window === 'undefined') return;
  for (const page of PAGES) window.localStorage.removeItem(pageStorageKey(page));
  window.dispatchEvent(new CustomEvent('nekotrip:replay-onboarding'));
}

export function OnboardingTour({ page }: { page: OnboardingPage }) {
  const steps = useMemo(() => stepsByPage[page], [page]);
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const openTour = useCallback(() => {
    setStepIndex(0);
    setActive(true);
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(pageStorageKey(page)) !== 'done') openTour();
    } catch {
      openTour();
    }

    const replay = () => openTour();
    window.addEventListener('nekotrip:replay-onboarding', replay);
    return () => window.removeEventListener('nekotrip:replay-onboarding', replay);
  }, [openTour, page]);

  const closeForPage = useCallback(() => {
    try {
      window.localStorage.setItem(pageStorageKey(page), 'done');
    } catch {
      // localStorage may be unavailable; closing the current session still works.
    }
    setActive(false);
  }, [page]);

  const skipAll = useCallback(() => {
    try {
      for (const knownPage of PAGES) {
        window.localStorage.setItem(pageStorageKey(knownPage), 'done');
      }
    } catch {
      // localStorage may be unavailable; closing the current session still works.
    }
    setActive(false);
  }, []);

  useEffect(() => {
    if (!active) return;

    const step = steps[stepIndex];
    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) {
      // UI can legitimately differ by role/state. Skip an unavailable coach mark.
      if (stepIndex < steps.length - 1) setStepIndex((value) => value + 1);
      else closeForPage();
      return;
    }

    target.classList.add('onboardingTarget');
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    const updatePosition = () => {
      const rect = target.getBoundingClientRect();
      const cardWidth = Math.min(360, Math.max(280, window.innerWidth - 32));
      const preferredLeft = rect.left + Math.min(rect.width / 2, 180) - cardWidth / 2;
      const left = Math.max(16, Math.min(preferredLeft, window.innerWidth - cardWidth - 16));

      const below = rect.bottom + 14;
      const estimatedCardHeight = 220;
      const top = below + estimatedCardHeight < window.innerHeight
        ? below
        : Math.max(16, rect.top - estimatedCardHeight - 14);

      setPosition({ top, left, width: cardWidth });
    };

    const timer = window.setTimeout(updatePosition, 180);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      target.classList.remove('onboardingTarget');
    };
  }, [active, closeForPage, stepIndex, steps]);

  if (!active) return null;

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  return <>
    <div className="onboardingBackdrop" aria-hidden="true" />
    {position && <section
      className="onboardingCoach"
      role="dialog"
      aria-modal="true"
      aria-label="NekoTrip quick tour"
      style={{ top: position.top, left: position.left, width: position.width }}
    >
      <div className="onboardingCoachProgress">
        <span>NekoTrip quick tour</span>
        <span>{stepIndex + 1} / {steps.length}</span>
      </div>
      <h2>{step.title}</h2>
      <p>{step.body}</p>
      <div className="onboardingCoachActions">
        <button className="secondaryButton compactButton" type="button" onClick={skipAll}>Skip tutorial</button>
        <div>
          {stepIndex > 0 && <button
            className="secondaryButton compactButton"
            type="button"
            onClick={() => setStepIndex((value) => Math.max(0, value - 1))}
          >
            Back
          </button>}
          <button
            className="primaryButton compactButton"
            type="button"
            onClick={() => {
              if (isLast) closeForPage();
              else setStepIndex((value) => Math.min(steps.length - 1, value + 1));
            }}
          >
            {isLast ? 'Got it' : 'Next →'}
          </button>
        </div>
      </div>
    </section>}
  </>;
}
