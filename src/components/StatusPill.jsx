import React from 'react';
import { statusClass } from '../lib/data.js';

export function StatusPill({ status, label }) {
  return <span className={`status-pill ${statusClass(status)}`}>{label || status}</span>;
}

export function ProgressBar({ value = 0 }) {
  return <div className="progress-bar" aria-label={`${value}% complete`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
