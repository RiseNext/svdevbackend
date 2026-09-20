import * as migration_20260920_153759_initial_schema from './20260920_153759_initial_schema';
import * as migration_20260920_160000_testimonial_consent_check from './20260920_160000_testimonial_consent_check';

export const migrations = [
  {
    up: migration_20260920_153759_initial_schema.up,
    down: migration_20260920_153759_initial_schema.down,
    name: '20260920_153759_initial_schema'
  },
  {
    up: migration_20260920_160000_testimonial_consent_check.up,
    down: migration_20260920_160000_testimonial_consent_check.down,
    name: '20260920_160000_testimonial_consent_check'
  },
];
