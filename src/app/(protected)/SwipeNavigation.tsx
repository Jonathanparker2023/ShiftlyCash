"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode, TouchEvent } from "react";
import { useRef } from "react";

const DEFAULT_SWIPE_ROUTES = [
  "/",
  "/baseline",
  "/history",
  "/paychecks",
  "/projects",
  "/debt",
  "/net-worth",
] as const;

const MIN_SWIPE_DISTANCE_PX = 35;
const MAX_VERTICAL_DRIFT_PX = 120;
const MOBILE_POINTER_WIDTH_PX = 768;

type SwipeStart = {
  x: number;
  y: number;
};

export function SwipeNavigation({
  children,
  routes = DEFAULT_SWIPE_ROUTES,
}: {
  children: ReactNode;
  routes?: readonly string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const swipeStart = useRef<SwipeStart | null>(null);

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];

    if (
      !touch
      || window.innerWidth >= MOBILE_POINTER_WIDTH_PX
      || isInteractiveElement(event.target)
    ) {
      swipeStart.current = null;
      return;
    }

    swipeStart.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    const touch = event.changedTouches[0];

    if (!start || !touch) {
      return;
    }

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (
      Math.abs(deltaX) < MIN_SWIPE_DISTANCE_PX
      || Math.abs(deltaY) > MAX_VERTICAL_DRIFT_PX
      || Math.abs(deltaX) < Math.abs(deltaY) * 1.15
    ) {
      return;
    }

    const currentIndex = getRouteIndex(pathname, routes);
    if (currentIndex === -1) {
      return;
    }

    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextRoute = routes[nextIndex];

    if (nextRoute) {
      router.push(nextRoute);
    }
  }

  return (
    <div
      onTouchCancel={() => {
        swipeStart.current = null;
      }}
      onTouchEnd={handleTouchEnd}
      onTouchStart={handleTouchStart}
      style={{ touchAction: "pan-y" }}
    >
      {children}
    </div>
  );
}

function getRouteIndex(pathname: string, routes: readonly string[]): number {
  if (pathname === "/") {
    return 0;
  }

  const matchedRoute = routes.findLast(
    (route) => route !== "/" && pathname.startsWith(route),
  );

  return matchedRoute ? routes.indexOf(matchedRoute) : -1;
}

function isInteractiveElement(target: EventTarget): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      'a,button,input,textarea,select,[role="button"],[contenteditable="true"],[data-no-page-swipe="true"]',
    ),
  );
}
