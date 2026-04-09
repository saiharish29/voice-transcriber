/**
 * Tests for ApiKeySetup component.
 *
 * Flow under test:  Provider selection  →  API key entry  →  Model selection
 *
 * Network calls are mocked — we test component behaviour, not real provider APIs.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the provider-agnostic helpers used by ApiKeySetup
vi.mock('@/services/transcription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/transcription')>();
  return {
    ...actual,
    validateApiKey: vi.fn(),
    fetchModels:    vi.fn(),
  };
});

vi.mock('@/services/config', () => ({
  saveConfig:  vi.fn(),
  loadConfig:  vi.fn().mockReturnValue(null),
  clearConfig: vi.fn(),
}));

import { ApiKeySetup } from '@/components/ApiKeySetup';
import { validateApiKey, fetchModels } from '@/services/transcription';

// Helper: advance from provider selection to the key entry step
const selectGemini = () => fireEvent.click(screen.getByText('Google Gemini'));

// ── Provider selection step ───────────────────────────────────────────────────

describe('ApiKeySetup — provider selection (step 0)', () => {
  it('renders the app title', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    expect(screen.getByText('Voice Transcriber')).toBeInTheDocument();
  });

  it('shows all three provider cards', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    expect(screen.getByText('Google Gemini')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Groq')).toBeInTheDocument();
  });

  it('advances to key entry when Gemini is clicked', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    selectGemini();
    expect(screen.getByPlaceholderText(/AIza/i)).toBeInTheDocument();
  });

  it('advances to key entry when OpenAI is clicked', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    fireEvent.click(screen.getByText('OpenAI'));
    expect(screen.getByPlaceholderText(/sk-/i)).toBeInTheDocument();
  });

  it('advances to key entry when Groq is clicked', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    fireEvent.click(screen.getByText('Groq'));
    expect(screen.getByPlaceholderText(/gsk_/i)).toBeInTheDocument();
  });
});

// ── Key entry step ────────────────────────────────────────────────────────────

describe('ApiKeySetup — key entry step (after selecting Gemini)', () => {
  beforeEach(() => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    selectGemini();
  });

  it('shows the API key password input', () => {
    expect(screen.getByPlaceholderText(/AIza/i)).toBeInTheDocument();
  });

  it('shows the Continue button disabled when input is empty', () => {
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('enables Continue button when user types a key', () => {
    fireEvent.change(screen.getByPlaceholderText(/AIza/i), { target: { value: 'AIza-test' } });
    expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled();
  });

  it('shows security note about localStorage', () => {
    expect(screen.getByText(/stays private/i)).toBeInTheDocument();
  });

  it('shows step indicators (API Key, Model)', () => {
    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
  });

  it('has a back link to change provider', () => {
    expect(screen.getByText(/change provider/i)).toBeInTheDocument();
  });

  it('navigates back to provider selection when back link is clicked', () => {
    fireEvent.click(screen.getByText(/change provider/i));
    expect(screen.getByText('Google Gemini')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/AIza/i)).not.toBeInTheDocument();
  });
});

// ── Invalid key ───────────────────────────────────────────────────────────────

describe('ApiKeySetup — invalid key submission', () => {
  beforeEach(() => {
    (validateApiKey as any).mockResolvedValue({ valid: false, error: 'Invalid API key' });
  });

  it('shows an error message when validation fails', async () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    selectGemini();
    fireEvent.change(screen.getByPlaceholderText(/AIza/i), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByText(/Invalid API key/i)).toBeInTheDocument());
  });

  it('stays on key step after a failed validation', async () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    selectGemini();
    fireEvent.change(screen.getByPlaceholderText(/AIza/i), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/AIza/i)).toBeInTheDocument());
    expect(screen.queryByText(/Start Transcribing/i)).not.toBeInTheDocument();
  });
});

// ── Valid key → model selection ───────────────────────────────────────────────

describe('ApiKeySetup — valid key → model selection step', () => {
  const mockModels = [
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', description: '', isRecommended: true,  inputTokenLimit: 1_000_000 },
    { id: 'gemini-1.5-pro',   displayName: 'Gemini 1.5 Pro',   description: '', isRecommended: false, inputTokenLimit: 2_000_000 },
  ];

  beforeEach(() => {
    (validateApiKey as any).mockResolvedValue({ valid: true });
    (fetchModels    as any).mockResolvedValue(mockModels);
  });

  it('advances to model selection after valid key', async () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    selectGemini();
    fireEvent.change(screen.getByPlaceholderText(/AIza/i), { target: { value: 'AIza-valid' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByText('Gemini 2.5 Flash')).toBeInTheDocument());
  });

  it('shows the Start Transcribing button on model step', async () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    selectGemini();
    fireEvent.change(screen.getByPlaceholderText(/AIza/i), { target: { value: 'AIza-valid' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByText(/Start Transcribing/i)).toBeInTheDocument());
  });

  it('calls onConfigured callback after finishing setup', async () => {
    const onConfigured = vi.fn();
    render(<ApiKeySetup onConfigured={onConfigured} />);
    selectGemini();
    fireEvent.change(screen.getByPlaceholderText(/AIza/i), { target: { value: 'AIza-valid' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => screen.getByText(/Start Transcribing/i));
    fireEvent.click(screen.getByText(/Start Transcribing/i));
    await waitFor(() => expect(onConfigured).toHaveBeenCalledOnce(), { timeout: 2000 });
  });
});
