import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardSummary } from '@/components/DashboardSummary';
import { Api } from '@/lib/api/client';
import type { DashboardSummary as Summary } from '@/lib/api/types';
import type { InterviewReport } from '@/lib/api/types';
vi.mock('@tanstack/react-router', () => ({ Link: ({ children, to }: any) => <a href={to}>{children}</a> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const empty: Summary = { completedCount: 0, recentActivity: [], groups: [], strengths: [], weaknesses: [], suggestions: [] };
const group = { role: 'QA Engineer', type: 'Behavioral', mode: 'Practice', level: 'Junior', latestInterviewId: 'one', scoredCount: 1,
  overall: 7, scores: { accuracy: 8, completeness: 7, clarity: null, structure: 6 },
  trends: [{ interviewId: 'one', date: '2026-10-19T00:00:00Z', overall: 7 }] } as const;
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DashboardSummary /></QueryClientProvider>);
  return client;
}
function interviewReport(id: string, mode: 'Practice' | 'Real Interview', strength: string, gap: string, topic: string) {
  return {
    interview: { id, setup: { role: 'QA Engineer', type: 'Behavioral', mode, level: 'Junior' } },
    feedback: {
      interviewId: id,
      strengths: [strength],
      gaps: [gap],
      questions: [{ miss: gap, practiceTopic: topic, practiceTopics: [topic] }],
    },
  } as unknown as InterviewReport;
}
it('shows loading, empty account and setup without demo data', async () => {
  let done!: (data: Summary) => void;
  vi.spyOn(Api, 'getDashboardSummary').mockReturnValue(new Promise(resolve => { done = resolve; }));
  const client = open();
  expect(screen.getByRole('status')).toHaveTextContent('Loading progress');
  done(empty);
  await screen.findByText('Complete an interview to start tracking progress.');
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(/Complete practice interviews to build a learning plan/)).toBeVisible();
  expect(screen.queryByText('6.8')).toBeNull();
  client.clear();
});
it('supports retry after failed summary', async () => {
  const request = vi.spyOn(Api, 'getDashboardSummary').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(empty);
  const client = open();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry progress' }));
  await screen.findByText('No recent activity yet.');
  expect(request).toHaveBeenCalledTimes(2);
  client.clear();
});
it('shows one point, dates, nullable categories, evidence, and switches compatible groups', async () => {
  vi.spyOn(Api, 'getDashboardSummary').mockResolvedValue({ ...empty, completedCount: 3,
    groups: [{ ...group, trends: [...group.trends] }, { ...group, mode: 'Real Interview', latestInterviewId: 'three', overall: 9, scoredCount: 2,
      trends: [{ interviewId: 'two', date: '2026-10-20T00:00:00Z', overall: 8 }, { interviewId: 'three', date: '2026-10-21T00:00:00Z', overall: 10 }] }],
    strengths: [{ text: 'Supported strength', sources: [{ interviewId: 'one', answerId: 'a' }] }, { text: 'Unsupported claim', sources: [] }],
    weaknesses: [{ text: 'Supported gap', sources: [{ interviewId: 'one', answerId: 'a' }] }],
    suggestions: [{ topic: 'Explain tradeoffs', setup: { role: 'QA Engineer', type: 'Behavioral', level: 'Junior' } as any,
      sources: [{ interviewId: 'one', answerId: 'a' }, { interviewId: 'three', answerId: 'b' }] }],
  });
  vi.spyOn(Api, 'getReport').mockImplementation(async (id) =>
    id === 'one'
      ? interviewReport('one', 'Practice', 'Practice strength', 'Practice gap', 'Test design')
      : interviewReport('three', 'Real Interview', 'Interview strength', 'Interview gap', 'Selenium WebDriver'),
  );
  const client = open();
  await screen.findByText(/One scored interview/);
  expect(screen.getByRole('img')).toHaveAccessibleName(/scores from 1 to 10/);
  expect(screen.getByRole('table')).toHaveAccessibleName('Score trend values (1–10)');
  expect(screen.getByText('2026-10-19')).toBeVisible();
  expect(screen.getByText('Not scored')).toBeVisible();
  expect(await screen.findByText('Practice strength')).toBeVisible();
  expect(screen.getByText('Practice gap')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Start practice: Explain tradeoffs' })).toHaveAttribute('href', '/setup');
  expect(screen.getByText('This area appeared in 2 completed interviews.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Review interview 1' })).toHaveAttribute('href', '/report');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.getByText('You dismissed the current recommendations. Refresh the plan to review them again.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh plan' }));
  expect(await screen.findByRole('link', { name: 'Start practice: Explain tradeoffs' })).toBeVisible();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
  expect(screen.queryByText(/One scored interview/)).toBeNull();
  expect(screen.getByText('2026-10-20')).toBeVisible();
  expect(screen.getByText('2026-10-21')).toBeVisible();
  expect(await screen.findByText('Interview strength')).toBeVisible();
  expect(screen.getByText('Interview gap')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Start practice: Explain tradeoffs' })).toBeVisible();
  expect(screen.queryByText('Practice strength')).toBeNull();
  client.clear();
});
it('shows an unscored group without manufacturing a trend', async () => {
  vi.spyOn(Api, 'getDashboardSummary').mockResolvedValue({ ...empty, completedCount: 1,
    groups: [{ ...group, overall: null, scoredCount: 0, trends: [], scores: { accuracy: null, completeness: null, clarity: null, structure: null } }] });
  const client = open();
  await screen.findByText('No scored interviews in this group.');
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  client.clear();
});
