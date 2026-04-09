/**
 * Tests for AudioInput component.
 *
 * Focus: tab switching, file validation, participant fields, context passed to callback.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AudioInput } from '@/components/AudioInput';

const noop = vi.fn();

describe('AudioInput — initial render', () => {
  it('shows Upload File and Record Live tabs', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    expect(screen.getByText('Upload File')).toBeInTheDocument();
    expect(screen.getByText('Record Live')).toBeInTheDocument();
  });

  it('defaults to the Upload tab', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    expect(screen.getByText(/Drop your audio or video file/i)).toBeInTheDocument();
  });

  it('always shows the participant section', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    expect(screen.getByText(/Who is in this meeting/i)).toBeInTheDocument();
  });

  it('shows the Your name input field', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    expect(screen.getByPlaceholderText(/e\.g\. Harish/i)).toBeInTheDocument();
  });

  it('shows the Add participant input', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    expect(screen.getByPlaceholderText(/Add a name/i)).toBeInTheDocument();
  });

  it('shows amber warning when no names provided', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    expect(screen.getByText(/No names provided/i)).toBeInTheDocument();
  });

  it('does NOT show the Transcribe button before a file is selected', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    expect(screen.queryByText(/Transcribe Now/i)).not.toBeInTheDocument();
  });
});

describe('AudioInput — tab switching', () => {
  it('switches to Record Live tab on click', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    fireEvent.click(screen.getByText('Record Live'));
    expect(screen.getByText(/Ready to record/i)).toBeInTheDocument();
  });

  it('switches back to Upload tab', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    fireEvent.click(screen.getByText('Record Live'));
    fireEvent.click(screen.getByText('Upload File'));
    expect(screen.getByText(/Drop your audio or video file/i)).toBeInTheDocument();
  });
});

describe('AudioInput — participant management', () => {
  it('adds a participant when Add is clicked', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    fireEvent.change(screen.getByPlaceholderText(/Add a name/i), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    expect(screen.getByText('Priya')).toBeInTheDocument();
  });

  it('adds participant on Enter key press', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    const input = screen.getByPlaceholderText(/Add a name/i);
    fireEvent.change(input, { target: { value: 'Raj' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Raj')).toBeInTheDocument();
  });

  it('does not add duplicate participant names', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    const input = screen.getByPlaceholderText(/Add a name/i);
    fireEvent.change(input, { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    fireEvent.change(input, { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    const chips = screen.getAllByText('Priya');
    expect(chips.length).toBe(1);
  });

  it('removes a participant when × is clicked', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    fireEvent.change(screen.getByPlaceholderText(/Add a name/i), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    fireEvent.click(screen.getByText('×'));
    expect(screen.queryByText('Priya')).not.toBeInTheDocument();
  });

  it('hides the amber no-names warning once a host name is typed', () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Harish/i), { target: { value: 'Harish' } });
    expect(screen.queryByText(/No names provided/i)).not.toBeInTheDocument();
  });
});

describe('AudioInput — file selection triggers Transcribe button', () => {
  it('shows Transcribe Now button after a valid file is dropped', async () => {
    render(<AudioInput onTranscribe={noop} disabled={false} />);
    const dropZone = screen.getByText(/Drop your audio or video file/i).closest('div')!;
    const file = new File(['audio content'], 'meeting.mp3', { type: 'audio/mpeg' });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Transcribe Now/i)).toBeInTheDocument());
  });
});

describe('AudioInput — context passed to onTranscribe', () => {
  it('passes hostName and participants in context object', async () => {
    const onTranscribe = vi.fn();
    render(<AudioInput onTranscribe={onTranscribe} disabled={false} />);

    // Set host name
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Harish/i), { target: { value: 'Harish' } });

    // Add a participant
    fireEvent.change(screen.getByPlaceholderText(/Add a name/i), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));

    // Drop a file
    const dropZone = screen.getByText(/Drop your audio or video file/i).closest('div')!;
    const file = new File(['audio content'], 'meeting.mp3', { type: 'audio/mpeg' });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    // Click Transcribe Now
    await waitFor(() => screen.getByText(/Transcribe Now/i));
    fireEvent.click(screen.getByText(/Transcribe Now/i));

    expect(onTranscribe).toHaveBeenCalledOnce();
    const [passedFile, passedCtx] = onTranscribe.mock.calls[0];
    expect(passedFile.name).toBe('meeting.mp3');
    expect(passedCtx.hostName).toBe('Harish');
    expect(passedCtx.participants).toContain('Priya');
  });

  it('passes empty context when no names filled in', async () => {
    const onTranscribe = vi.fn();
    render(<AudioInput onTranscribe={onTranscribe} disabled={false} />);
    const dropZone = screen.getByText(/Drop your audio or video file/i).closest('div')!;
    fireEvent.drop(dropZone, { dataTransfer: { files: [new File(['x'], 'test.mp3', { type: 'audio/mpeg' })] } });
    await waitFor(() => screen.getByText(/Transcribe Now/i));
    fireEvent.click(screen.getByText(/Transcribe Now/i));
    const [, ctx] = onTranscribe.mock.calls[0];
    expect(ctx.hostName).toBe('');
    expect(ctx.participants).toEqual([]);
  });
});

describe('AudioInput — disabled state', () => {
  it('disables tab switching when disabled=true', () => {
    render(<AudioInput onTranscribe={noop} disabled={true} />);
    expect(screen.getByText('Record Live').closest('button')).toBeDisabled();
  });
});
