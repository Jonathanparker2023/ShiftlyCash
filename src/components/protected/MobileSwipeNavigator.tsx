"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

import { PROTECTED_NAV } from "@/lib/protected-nav";

const SWIPE_THRESHOLD_PX = 50;
const MAX_VERTICAL_RATIO = 0.6;
const MOBILE_MAX_WIDTH_PX = 768;

type TouchStart = {
  x: number;
  y: number;
  disabled: boolean;
};

export function MobileSwipeNavigator({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<TouchStart | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    function isMobile(): boolean {
      return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches;
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || !isMobile()) {
        startRef.current = null;
        return;
      }

      const touch = event.touches[0];
      const disabled = shouldDisableSwipe(event.target);
      startRef.current = { x: touch.clientX, y: touch.clientY, disabled };
    }

    function handleTouchEnd(event: TouchEvent) {
      const start = startRef.current;
      startRef.current = null;

      if (!start || start.disabled) {
        return;
      }

      // Bail out if a shift-bar drag captured this gesture mid-flight.
      if (document.documentElement.dataset.shiftBarDragging === "true") {
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }

      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) {
        return;
      }
      if (Math.abs(dy) > Math.abs(dx) * MAX_VERTICAL_RATIO) {
        return;
      }

      const currentIndex = PROTECTED_NAV.findIndex(
        (route) => route.href === pathname,
      );
      if (currentIndex < 0) {
        return;
      }

      const nextIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= PROTECTED_NAV.length) {
        return;
      }

      router.push(PROTECTED_NAV[nextIndex].href);
    }

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [pathname, router]);

  return (
    <div ref={containerRef} className="w-full max-w-[100vw] overflow-x-hidden">
      {children}
    </div>
  );
}

function shouldDisableSwipe(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest("[data-disable-swipe-nav]")) {
    return true;
  }

  let element: Element | null = target;
  while (element && element !== document.body) {
    const style = window.getComputedStyle(element);
    const overflowX = style.overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      element.scrollWidth > element.clientWidth
    ) {
      return true;
    }
    element = element.parentElement;
  }

  return false;
}
