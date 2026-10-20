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
export type InterviewLanguage = "English" | "Russian";

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
  language: InterviewLanguage;
  jobDescription?: string;
  practiceTopic?: string | null;
}

export type CodeRunStatus =
  "success" | "compile-error" | "runtime-error" | "timeout" | "output-limit" | "unavailable";

export interface CodeRunRequest {
  language: string;
  code: string;
}

export interface CodeRunResult {
  status: CodeRunStatus;
  stdout: string;
  stderr: string;
}

export interface Message {
  id: string;
  interviewId: string;
  from: "ai" | "you" | "hint";
  text: string;
  createdAt: string;
  kind?: "main" | "follow-up";
  mainQuestionId?: string | null;
  codingQuestionId?: string | null;
  codingJudge?: CodingJudgeSummary | null;
}

export interface CodingJudgeSummary {
  status: "passed" | "failed" | "compile-error" | "runtime-error" | "timeout" | "unavailable";
  passed: number;
  total: number;
  summary: string;
}

export interface InterviewMediaInfo {
  id: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
}

export interface InterviewMediaList {
  retentionDays: number;
  media: InterviewMediaInfo[];
}

export interface DifficultyDecision {
  questionId: string;
  answerId: string;
  previousLevel: Level;
  effectiveLevel: Level;
  average: number | null;
  reason: string;
}

export interface Scores {
  accuracy: number | null;
  completeness: number | null;
  clarity: number | null;
  structure: number | null;
}

export interface AnswerEvaluation extends Scores {
  went_well: string;
  missing: string;
  stronger_answer: string;
  practice_topic?: string | null;
}

export interface Feedback {
  interviewId: string;
  answeredQuestions: number;
  selectedQuestions: 5 | 10 | 15;
  overall: number | null;
  scores: Scores | null;
  strengths: string[];
  gaps: string[];
  questions: {
    questionId: string;
    answerId: string;
    q: string;
    answer: string;
    score: number | null;
    scores?: Scores | null;
    good: string;
    miss: string;
    better: string;
    practiceTopic?: string | null;
    practiceTopics?: string[];
    codingJudge?: CodingJudgeSummary | null;
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
  lastCodingJudge?: CodingJudgeSummary | null;
  effectiveLevel?: Level | null;
  difficultyDecisions?: DifficultyDecision[];
}

export interface InterviewReport {
  interview: Interview;
  feedback: Feedback;
}

export interface EvaluationFeedback {
  answerId: string;
  rating: "helpful" | "needs_review" | null;
  category: "incorrect" | "unclear" | "irrelevant" | "wrong_language" | "other" | null;
  comment: string | null;
  updatedAt: string | null;
  provenanceStatus: "unknown";
}

export interface JobTarget {
  id: string;
  title: string;
  company: string | null;
  role: Role;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobTargetList {
  items: JobTarget[];
  limit: number;
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
  latestInterviewId: string;
  suggestions: PracticeSuggestion[];
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

export interface StudyQuestion {
  id: string;
  interviewId: string;
  questionId: string;
  prompt: string;
  note: string;
  savedAt: string;
}
export interface StudyPage { items: StudyQuestion[]; total: number; page: number; pageSize: number; }
