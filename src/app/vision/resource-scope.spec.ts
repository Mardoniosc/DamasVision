import { Deletable, ResourceScope, withResources } from './resource-scope';

class FakeMat implements Deletable {
  deleted = 0;
  constructor(
    readonly log: string[],
    readonly name: string,
    private readonly failOnDelete = false,
  ) {}
  delete(): void {
    this.deleted++;
    this.log.push(this.name);
    if (this.failOnDelete) throw new Error(`cannot delete ${this.name}`);
  }
  isDeleted(): boolean {
    return this.deleted > 0;
  }
}

describe('ResourceScope', () => {
  it('releases every tracked resource once, in reverse order', () => {
    const log: string[] = [];
    const scope = new ResourceScope();
    const a = scope.track(new FakeMat(log, 'a'));
    const b = scope.track(new FakeMat(log, 'b'));

    scope.dispose();
    scope.dispose();

    expect(log).toEqual(['b', 'a']);
    expect(a.deleted + b.deleted).toBe(2);
  });

  it('deletes immediately what is tracked after disposal', () => {
    const scope = new ResourceScope();
    scope.dispose();
    const late = new FakeMat([], 'late');

    expect(() => scope.track(late)).toThrow();
    expect(late.deleted).toBe(1);
  });

  it('withResources() releases on success and returns the result', () => {
    const log: string[] = [];

    const result = withResources((scope) => {
      scope.track(new FakeMat(log, 'm'));
      return 42;
    });

    expect(result).toBe(42);
    expect(log).toEqual(['m']);
  });

  it('withResources() releases on failure and rethrows the original error', () => {
    const log: string[] = [];

    expect(() =>
      withResources((scope) => {
        scope.track(new FakeMat(log, 'm', true));
        throw new Error('processing failed');
      }),
    ).toThrow('processing failed');
    expect(log).toEqual(['m']);
  });

  it('withResources() reports release failures when the work succeeded', () => {
    const log: string[] = [];

    expect(() =>
      withResources((scope) => {
        scope.track(new FakeMat(log, 'ok'));
        scope.track(new FakeMat(log, 'bad', true));
      }),
    ).toThrow(AggregateError);
    expect(log).toEqual(['bad', 'ok']);
  });
});
