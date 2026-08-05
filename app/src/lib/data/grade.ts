export interface GradeSummary {
  /** The numeral or range: "3", "1/2", "3-4", or a lettered grade. */
  level: string | null;
  /** The run of quality stars the guide appends, kept separate from the level. */
  stars: string | null;
}

// A grade field from Mountain Meanders reads "<level><stars>: <prose>", and the
// prose runs long: 80 of the 152 graded routes exceed 24 characters, the worst
// 145. Only the level and stars are a grade; the rest is route description that
// belongs on the route page.
//
// The level is digits, optionally a range ("1/2", "3-4"), or one or two letters
// for the handful graded by letter. Bounded to two letters on purpose: an
// inferred (gradeSource 'prose') field can begin with an ordinary word, and
// matching that would present "Moderate" as if it were a grade.
const GRADE = /^\s*(\d+(?:\s*[/-]\s*\d+)?|[A-Za-z]{1,2})\s*(\*+)?(?=$|[\s:*])/;

export function summariseGrade(grade: string | null): GradeSummary {
  const match = grade?.match(GRADE);
  if (!match) return { level: null, stars: null };
  return {
    level: match[1].replace(/\s+/g, ''),
    stars: match[2] ?? null
  };
}
