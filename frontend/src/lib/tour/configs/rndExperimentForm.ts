import { TourConfig } from '../types'
import { RND_EXP_TYPE_OPTIONS } from './rndShared'

const config: TourConfig = {
  id: 'rnd-experiment-form',
  pageTitle: 'New Experiment',
  steps: [
    {
      target: 'rnd-ef-form',
      title: 'New Experiment form',
      purpose: 'Details on the left, objective and method on the right, the test parameters grid below; Save / Cancel are at the bottom.',
    },
    {
      target: 'rnd-ef-back-btn',
      title: '← Back',
      purpose: 'Returns to the experiment list without saving.',
    },
    {
      target: 'rnd-ef-project',
      title: 'Project',
      purpose: 'The R&D project this experiment belongs to.',
      required: true,
    },
    {
      target: 'rnd-ef-prototype',
      title: 'Prototype',
      purpose: 'Optional — the prototype being tested. Only prototypes of the chosen project are listed; pick the project first.',
      why: 'Linking tests to a prototype builds its test history, which decides whether it can be Validated and released.',
    },
    {
      target: 'rnd-ef-title',
      title: 'Title',
      required: true,
      validExample: 'Static load test — bogie frame v2 at 1.5× rated load',
    },
    {
      target: 'rnd-ef-type',
      title: 'Type',
      options: RND_EXP_TYPE_OPTIONS,
    },
    {
      target: 'rnd-ef-date',
      title: 'Experiment Date',
      purpose: 'When the test is or was done. Defaults to today.',
    },
    {
      target: 'rnd-ef-conducted-by',
      title: 'Conducted By',
      purpose: 'Engineer who ran the test. Leave empty to record yourself.',
    },
    {
      target: 'rnd-ef-objective',
      title: 'Objective / Hypothesis',
      purpose: 'What you expect to prove.',
      validExample: 'Frame withstands 1.5× rated load with no permanent deformation.',
      why: 'Writing the expected outcome BEFORE testing keeps the test honest — you check results against it.',
    },
    {
      target: 'rnd-ef-method',
      title: 'Method / Procedure',
      purpose: 'How the test is done — setup, equipment, steps, standard followed — so someone else can repeat it.',
    },
    {
      target: 'rnd-ef-params',
      title: 'Test Parameters',
      purpose: 'One row per measured value: Parameter name (required if the row has anything in it), Specification (the limit, e.g. "≥ 12"), Measured value, Unit, and Pass / Fail for that row. Empty rows are ignored; × removes a row.',
      validExample: 'Brake force | ≥ 12 | 13.4 | kN | Pass',
      invalidExample: 'A row with a measured value but no Parameter name — the form will ask you to name it.',
    },
    {
      target: 'rnd-ef-add-param-btn',
      title: '+ Add parameter',
      purpose: 'Adds another empty parameter row.',
    },
    {
      target: 'rnd-ef-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards the form.',
    },
    {
      target: 'rnd-ef-submit-btn',
      title: 'Save Experiment',
      purpose: 'Creates the experiment.',
      after: 'It gets an experiment number, starts as Planned, and its page opens — there you update status, overall result, observations, conclusion and attach test reports.',
    },
  ],
}

export default config
