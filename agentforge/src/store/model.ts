// Derived learner model: estimates, weaknesses, rank, plan inputs — memoised from the evidence log.
import { useMemo } from 'react';
import { useLearner } from './learner';
import { SKILLS } from '@/content/skills';
import { LESSONS } from '@/content/lessons';
import { estimateAll } from '@/core/engines/competency';
import { dueSkills } from '@/core/engines/review';
import { findWeaknesses } from '@/core/engines/weakness';
import { rankFor, earnedBadges } from '@/core/engines/progression';
import { recommendNext, buildPlan, pathSkills, type PlanInput } from '@/core/engines/planner';
import { PROJECTS } from '@/content/projects';

export function useModel() {
  const evidence = useLearner((s) => s.evidence);
  const reviews = useLearner((s) => s.reviews);
  const touched = useLearner((s) => s.touched);
  const profile = useLearner((s) => s.profile);
  const pinned = useLearner((s) => s.pinned);
  const skipped = useLearner((s) => s.skipped);
  const projects = useLearner((s) => s.projects);

  return useMemo(() => {
    const now = Date.now();
    const est = estimateAll(SKILLS, evidence, new Set(touched), reviews, now);
    const due = dueSkills(reviews, now).map((r) => r.skillId);
    const weaknesses = findWeaknesses(SKILLS, est, evidence, now);
    const mastered = Object.values(est).filter((e) => e.state === 'mastered' || e.state === 'review-due').length;
    const projectsDone = PROJECTS.filter((p) => projects[p.id]?.completedAt).length;
    const rank = rankFor(mastered, projectsDone);
    const badges = earnedBadges(est);
    const planInput: PlanInput | null = profile
      ? { profile, skills: SKILLS, lessons: LESSONS, estimates: est, dueReviewSkills: due, pinned, skipped, now }
      : null;
    const next = planInput ? recommendNext(planInput) : [];
    const plan = planInput ? buildPlan(planInput) : [];
    const path = profile ? pathSkills(profile.path, SKILLS) : [];
    const pathMastered = path.filter((id) => est[id].state === 'mastered' || est[id].state === 'review-due').length;
    const pathPracticed = path.filter((id) => ['practiced', 'mastered', 'review-due'].includes(est[id].state)).length;
    return { est, due, weaknesses, mastered, projectsDone, rank, badges, next, plan, path, pathMastered, pathPracticed, now };
  }, [evidence, reviews, touched, profile, pinned, skipped, projects]);
}
