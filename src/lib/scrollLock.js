let lockCount = 0;
let savedOverflow = '';

/** Reference-counted body scroll lock for stacked modals. */
export function lockBodyScroll() {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;

  return () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow;
      savedOverflow = '';
    }
  };
}
