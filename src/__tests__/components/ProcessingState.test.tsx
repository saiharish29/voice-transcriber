import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProcessingState } from '@/components/ProcessingState';

describe('ProcessingState', () => {
  it('renders the stage text', () => {
    render(<ProcessingState stage="Transcribing" />);
    expect(screen.getByText('Transcribing')).toBeInTheDocument();
  });

  it('renders detail text when provided', () => {
    render(<ProcessingState stage="Uploading" detail="12.3 MB to Gemini File API..." />);
    expect(screen.getByText(/12\.3 MB/i)).toBeInTheDocument();
  });

  it('does not render detail section when omitted', () => {
    render(<ProcessingState stage="Preparing" />);
    // Only the stage heading should appear, no extra text
    expect(screen.queryByText(/MB/i)).not.toBeInTheDocument();
  });

  it('shows the keep-tab-open tip', () => {
    render(<ProcessingState stage="Transcribing" />);
    expect(screen.getByText(/keep this tab open/i)).toBeInTheDocument();
  });

  it('renders the animated spinner (spinning border div)', () => {
    const { container } = render(<ProcessingState stage="Transcribing" />);
    // The outer animated ring has animate-spin class
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders the bouncing dots', () => {
    const { container } = render(<ProcessingState stage="Transcribing" />);
    expect(container.querySelector('.animate-bounce')).toBeInTheDocument();
  });

  const STAGE_SAMPLES = ['Uploading', 'Transcribing', 'Retrying', 'Rate limit — waiting', 'Error', 'Ready'];
  STAGE_SAMPLES.forEach(stage => {
    it(`renders without crashing for stage="${stage}"`, () => {
      expect(() => render(<ProcessingState stage={stage} />)).not.toThrow();
    });
  });
});
