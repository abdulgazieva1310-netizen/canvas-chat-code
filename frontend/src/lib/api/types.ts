export type Role =
  | "Frontend Developer"
  | "Backend Developer"
  | "Full Stack Developer"
  | "Java Developer"
  | "Python Developer"
  | "C++ Developer"
  | "QA Engineer"
  | "Data Analyst"
  | "DevOps Engineer";
export type Level = "Junior" | "Middle" | "Senior";

export interface User {
  id: string;
  name: string;
  email: string;
  targetRole: Role;
  level: Level;
  preferredLanguage: string;
}

export type ProfileUpdate = Pick<User, "name" | "targetRole" | "level"> &
  Partial<Pick<User, "preferredLanguage">>;

export const targetRoles: Role[] = [
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "Java Developer",
  "Python Developer",
  "C++ Developer",
  "QA Engineer",
  "Data Analyst",
  "DevOps Engineer",
];

export interface InterviewSetup {
  role: Role;
  level: Level;
  mode: "Practice" | "Real Interview";
  questionCount: 5 | 10 | 15;
  type: "Technical" | "Behavioral" | "Role-specific";
  input: "Voice" | "Text";
  language: "English";
  jobDescription?: string;
}

export interface Message {
  id: string;
  interviewId: string;
  from: "ai" | "you" | "hint";
  text: string;
  createdAt: string;
}

export interface Scores {
  accuracy: number;
  completeness: number;
  clarity: number;
  structure: number;
}

export interface AnswerEvaluation extends Scores {
  went_well: string;
  missing: string;
  stronger_answer: string;
}

export interface Feedback {
  interviewId: string;
  overall: number | null;
  scores: Scores | null;
  strengths: string[];
  gaps: string[];
  questions: {
    q: string;
    answer: string;
    score: number | null;
    scores?: Scores | null;
    good: string;
    miss: string;
    better: string;
  }[];
}

export interface Interview {
  id: string;
  setup: InterviewSetup;
  status: "active" | "complete" | "incomplete";
  startedAt: string;
  endedAt: string | null;
  answeredCount: number;
  messages: Message[];
  lastFeedback: Scores | null;
  lastAnswerFeedback?: AnswerEvaluation | null;
}

export interface InterviewReport {
  interview: Interview;
  feedback: Feedback;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  targetRole?: Role;
  level?: Level;
}

export interface AnswerSubmission {
  text: string;
  selectedLanguage?: "Python" | "Java" | "C++" | "JavaScript" | "TypeScript";
}

/** Planned follow-up metadata for issue #18; current Message is unchanged. */
export interface PlannedMessage extends Message {
  kind: "main" | "follow-up" | "answer" | "hint";
  mainQuestionId: string;
  mainQuestionNumber: number;
}

/** Planned history contract for #40; migrate all array consumers together. */
export interface HistoryQuery {
  role?: Role;
  type?: InterviewSetup["type"];
  startDate?: string;
  endDate?: string;
  minScore?: number;
  maxScore?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface HistoryPage {
  items: Interview[];
  total: number;
  page: number;
  pageSize: number;
}

/** Planned nullable categories; null means unavailable or inapplicable. */
export type PlannedScores = { [Category in keyof Scores]: number | null };

export interface EvidenceReference {
  interviewId: string;
  answerId: string;
}

export interface EvidenceClaim {
  text: string;
  sources: EvidenceReference[];
}

export interface PracticeSuggestion {
  topic: string;
  setup: InterviewSetup;
  sources: EvidenceReference[];
}

export interface DashboardGroup {
  role: Role;
  type: InterviewSetup["type"];
  mode: InterviewSetup["mode"];
  level: Level;
  scoredCount: number;
  overall: number | null;
  scores: PlannedScores;
  trends: { interviewId: string; date: string; overall: number }[];
}

/** Planned GET /dashboard/summary, issue #32. */
export interface DashboardSummary {
  completedCount: number;
  recentActivity: Interview[];
  groups: DashboardGroup[];
  strengths: EvidenceClaim[];
  weaknesses: EvidenceClaim[];
  suggestions: PracticeSuggestion[];
}
