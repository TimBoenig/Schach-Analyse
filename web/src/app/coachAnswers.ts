// Coach answers (Trainerbericht, Partie-Erklärungen) are kept as one synced
// setting, so a report survives a reload, reaches the other devices and goes
// into the full export. The API key never does: it stays in localStorage.
import { COACH_ANSWERS_KEY, mergeCoachAnswers, type SavedCoachAnswer } from "../domain/export";
import { getSetting, setSetting } from "../storage/db";

export async function listCoachAnswers(): Promise<SavedCoachAnswer[]> {
  return getSetting<SavedCoachAnswer[]>(COACH_ANSWERS_KEY, []);
}

export async function getCoachAnswer(key: string): Promise<SavedCoachAnswer | undefined> {
  return (await listCoachAnswers()).find((a) => a.key === key);
}

export async function saveCoachAnswers(answers: SavedCoachAnswer[]): Promise<void> {
  await setSetting(COACH_ANSWERS_KEY, mergeCoachAnswers(await listCoachAnswers(), answers));
}
