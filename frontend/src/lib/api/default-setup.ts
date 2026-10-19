import type { InterviewSetup } from "./types";

export const defaultSetup: InterviewSetup = {
  role: "Frontend Developer",
  level: "Middle",
  mode: "Practice",
  questionCount: 10,
  type: "Technical",
  input: "Voice",
  language: "English",
};

export const quickStartDefaults: InterviewSetup = {
  role: "Backend Developer",
  level: "Junior",
  mode: "Practice",
  questionCount: 5,
  type: "Technical",
  input: "Text",
  language: "English",
};
