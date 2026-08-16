// Edit this file to change the first-run example and its onboarding copy.
export const WELCOME_FILE_NAME = 'FizzBuzz';

export const WELCOME_INTENT = `fizz-buzz(n)
  loop n
    divisible by 3 ? "fizz"
    by 5 ? "buzz"
    both ? "fizz buzz"`;

export const WELCOME_REPL_COMMAND = 'fizzBuzz(20)';

export const WELCOME_COPY = {
	title: 'WELCOME TO HUZZAH',
	description:
		'To your left is some pseudocode - change it however you like. When you press the sync button, we\'ll produce real code from it.',
	replHint:
		'The implementation is live. Run the prepared expression below, then revise the intent and synchronize again.'
} as const;
