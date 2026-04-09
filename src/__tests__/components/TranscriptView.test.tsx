/**
 * Tests for TranscriptView component.
 *
 * Focus: content display, action buttons, download, reset callback.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TranscriptView } from '@/components/TranscriptView';

const SAMPLE_TRANSCRIPT = `[00:00:00] Harish: Good morning everyone, let's get started.
[00:00:08] Priya: Morning! Can everyone hear me okay?
[00:00:45] Harish: Yes, all good. So the agenda today is the Q2 review.
[00:01:15] Raj: Sounds good. I have the numbers ready.`;

describe('TranscriptView — content rendering', () => {
  it('renders the transcript text', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText(/Good morning everyone/i)).toBeInTheDocument();
  });

  it('renders the file name in the header', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText('meeting.mp3')).toBeInTheDocument();
  });

  it('shows the Transcript Ready badge', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText(/Transcript Ready/i)).toBeInTheDocument();
  });

  it('shows word count stats', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText(/words/i)).toBeInTheDocument();
  });

  it('shows speaker turns count', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText(/speaker turns/i)).toBeInTheDocument();
  });
});

describe('TranscriptView — action buttons', () => {
  it('shows Copy button', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText(/^Copy$/i)).toBeInTheDocument();
  });

  it('shows .txt download button', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText('.txt')).toBeInTheDocument();
  });

  it('shows .md download button', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText('.md')).toBeInTheDocument();
  });

  it('shows New transcription button', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('calls onReset when New button is clicked', () => {
    const onReset = vi.fn();
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={onReset} />);
    fireEvent.click(screen.getByText('New'));
    expect(onReset).toHaveBeenCalledOnce();
  });
});

describe('TranscriptView — clipboard copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls clipboard.writeText with the transcript', async () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    fireEvent.click(screen.getByText(/^Copy$/i));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SAMPLE_TRANSCRIPT);
  });

  it('shows Copied! feedback after clicking Copy', async () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    fireEvent.click(screen.getByText(/^Copy$/i));
    // Immediate update after async clipboard call resolves
    await vi.waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });
});

describe('TranscriptView — next-step tip', () => {
  it('mentions Meeting Notes Generator as the next step', () => {
    render(<TranscriptView transcript={SAMPLE_TRANSCRIPT} fileName="meeting.mp3" onReset={vi.fn()} />);
    expect(screen.getByText(/Meeting Notes Generator/i)).toBeInTheDocument();
  });
});
