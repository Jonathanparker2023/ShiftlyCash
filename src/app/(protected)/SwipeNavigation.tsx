"use client";

import { usePathname, useRouter } from "next/navigation";
import type { PointerEvent, ReactNode } from "react";
import { useRef } from "react";

const SWIPE_ROUTES = [
  "/",
  "/baseline",
  "/history",
  "/paychecks",
  "/projects",
  "/debt",
  "/net-worth",
] as const;

const MIN_SWIPE_DISTANCE_PX = 70;
const MAX_VERTICAL_DRIFT_PX = 80;
const MOBILE_POINTER_WIDTH_PX = 768;

type SwipeStart = {
  x: number;
  y: number;
  pointerId: number;
};

export function SwipeNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const swipeStart = useRef<SwipeStart | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== "touch"
      || window.innerWidth >= MOBILE_POINTER_WIDTH_PX
      || isInteractiveElement(event.target)
    ) {
      swipeStart.current = null;
      return;
    }

    swipeStart.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;

    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;

    if (
      Math.abs(deltaX) < MIN_SWIPE_DISTANCE_PX
      || Math.abs(deltaY) > MAX_VERTICAL_DRIFT_PX
      || Math.abs(deltaX) <= Math.abs(deltaY)
    ) {
      return;
    }

    const currentIndex = getRouteIndex(pathname);
    if (currentIndex === -1) {
      return;
    }

    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextRoute = SWIPE_ROUTES[nextIndex];

    if (nextRoute) {
      router.push(nextRoute);
    }
  }

  return (
    <div onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}>
      {children}
    </div>
  );
}

function getRouteIndex(pathname: string): number {
  if (pathname === "/") {
    return 0;
  }

  const matchedRoute = SWIPE_ROUTES.findLast(
    (route) => route !== "/" && pathname.startsWith(route),
  );

  return matchedRoute ? SWIPE_ROUTES.indexOf(matchedRoute) : -1;
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
