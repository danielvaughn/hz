// Edit this file to change the first-run example and its onboarding copy.
export const WELCOME_FILE_NAME = 'FizzBuzz';

export const WELCOME_INTENT = `fizz-buzz(n)
  loop n
    divisible by 3 ? "fizz"
    by 5 ? "buzz"
    both ? "fizz buzz"`;

export const WELCOME_REPL_COMMAND = 'program.fizzBuzz(20)';

export const WELCOME_COPY = {
	title: 'Start with FizzBuzz',
	description:
		'The intent is already written on the left. Read it, change anything you like, then synchronize it into a working program.',
	replHint:
		'The implementation is live. Run the prepared expression below, then revise the intent and synchronize again.'
} as const;
