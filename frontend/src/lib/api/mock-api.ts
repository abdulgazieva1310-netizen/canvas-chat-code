import type {
  Feedback,
  Interview,
  InterviewReport,
  InterviewSetup,
  Message,
  RegisterData,
  Scores,
  User,
} from "./types";

import { defaultSetup } from "./default-setup";
export { defaultSetup } from "./default-setup";

const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 500));
const copy = <T>(value: T): T => structuredClone(value);
const storageKey = "interview-mirror.mock-interviews.v1";
const scores: Scores = { accuracy: 7.6, completeness: 6.1, clarity: 7.8, structure: 5.9 };

// Browser-only session storage keeps mock sessions across reloads without sharing
// user state through the SSR process. Passwords and raw audio are never stored.
function read(): Record<string, Interview> {
  if (typeof window === "undefined") return {};
  const raw = window.sessionStorage.getItem(storageKey);
  return raw ? JSON.parse(raw) : {};
}
function find(id: string): Interview {
  const interview = read()[id];
  if (!interview) throw new Error("Interview not found. Start a new interview from Setup.");
  return interview;
}
function save(interview: Interview): Interview {
  const interviews = read();
  interviews[interview.id] = interview;
  window.sessionStorage.setItem(storageKey, JSON.stringify(interviews));
  return copy(interview);
}
function message(interviewId: string, from: Message["from"], text: string): Message {
  return { id: crypto.randomUUID(), interviewId, from, text, createdAt: new Date().toISOString() };
}
function question(setup: InterviewSetup, index: number): string {
  const prompts =
    setup.type === "Behavioral"
      ? [
          "Tell me about a difficult problem you solved.",
          "Describe a disagreement with a teammate.",
          "How did you respond to critical feedback?",
        ]
      : [
          `Describe a core concept you use as a ${setup.role}.`,
          "How would you investigate a production issue?",
          "What trade-offs would you consider when designing a reliable system?",
        ];
  return `Question ${index + 1} (${setup.level}): ${prompts[index % prompts.length]}`;
}
function feedback(interview: Interview): Feedback {
  const answers = interview.messages.filter((m) => m.from === "you");
  const questions = interview.messages.filter((m) => m.from === "ai");
  return {
    interviewId: interview.id,
    overall: answers.length ? 6.9 : null,
    scores: answers.length ? copy(scores) : null,
    strengths: answers.length ? ["You provided an answer to the question."] : [],
    gaps: answers.length ? ["Practice adding concrete examples and measurable results."] : [],
    questions: answers.map((answer, i) => ({
      questionId: questions[i]?.id ?? "missing-question",
      answerId: answer.id,
      q: questions[i]?.text ?? "Interview question",
      answer: answer.text,
      score: 6.9,
      good: "You engaged with the question.",
      miss: "Consider explaining trade-offs and edge cases.",
      better:
        "State the situation, describe your approach with a concrete example, and close with the result.",
    })),
  };
}

/** Fake backend. Scores and coaching are illustrative fixtures, not AI evaluation. */
export const MockApi = {
  async login(email: string, password: string): Promise<User> {
    await delay();
    if (!email.includes("@") || !password) throw new Error("Enter an email and password.");
    return {
      id: "mock-user",
      name: "Aruzhan",
      email,
      targetRole: defaultSetup.role,
      level: defaultSetup.level,
      preferredLanguage: "English",
    };
  },
  async register(userData: RegisterData): Promise<User> {
    await delay();
    if (!userData.name.trim() || !userData.email.includes("@") || !userData.password)
      throw new Error("Name, email and password are required.");
    return {
      id: crypto.randomUUID(),
      name: userData.name,
      email: userData.email,
      targetRole: userData.targetRole ?? defaultSetup.role,
      level: userData.level ?? defaultSetup.level,
      preferredLanguage: "English",
    };
  },
  async startInterview(setupData: InterviewSetup): Promise<Interview> {
    await delay();
    if (![5, 10, 15].includes(setupData.questionCount))
      throw new Error("Choose 5, 10 or 15 questions.");
    const id = crypto.randomUUID();
    return save({
      id,
      setup: copy(setupData),
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      answeredCount: 0,
      messages: [message(id, "ai", question(setupData, 0))],
      lastFeedback: null,
    });
  },
  async getInterview(interviewId: string): Promise<Interview> {
    await delay();
    return copy(find(interviewId));
  },
  async sendMessage(interviewId: string, text: string): Promise<Interview> {
    await delay();
    const interview = find(interviewId);
    if (interview.status !== "active") throw new Error("This interview has ended.");
    if (!text.trim()) throw new Error("Enter an answer.");
    interview.messages.push(message(interviewId, "you", text.trim()));
    interview.answeredCount += 1;
    interview.lastFeedback = interview.setup.mode === "Practice" ? copy(scores) : null;
    if (interview.answeredCount >= interview.setup.questionCount) {
      interview.status = "complete";
      interview.endedAt = new Date().toISOString();
    } else {
      interview.messages.push(
        message(interviewId, "ai", question(interview.setup, interview.answeredCount)),
      );
    }
    return save(interview);
  },
  async getHint(interviewId: string): Promise<Interview> {
    await delay();
    const interview = find(interviewId);
    if (interview.status !== "active" || interview.setup.mode !== "Practice")
      throw new Error("Hints are only available during Practice mode.");
    interview.messages.push(
      message(
        interviewId,
        "hint",
        "Use a concrete example, explain your reasoning, and summarize the outcome.",
      ),
    );
    return save(interview);
  },
  async endInterview(interviewId: string): Promise<Interview> {
    await delay();
    const interview = find(interviewId);
    if (interview.status === "active") {
      interview.status = "incomplete";
      interview.endedAt = new Date().toISOString();
    }
    return save(interview);
  },
  async getReport(interviewId: string): Promise<InterviewReport> {
    await delay();
    const interview = find(interviewId);
    if (interview.status === "active")
      throw new Error("End the interview before viewing its report.");
    return { interview: copy(interview), feedback: feedback(interview) };
  },
  async getHistory(): Promise<Interview[]> {
    await delay();
    return Object.values(read())
      .filter((i) => i.status !== "active")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },
};
