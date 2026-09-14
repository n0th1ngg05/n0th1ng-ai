export interface WorkerJob {

    id: number;

    tool: string;

    startedAt: number;

}

let nextJobId = 1;

const jobs = new Map<number, WorkerJob>();

export function startJob(tool: string) {

    const job: WorkerJob = {

        id: nextJobId++,

        tool,

        startedAt: Date.now(),

    };

    jobs.set(job.id, job);

    return job;

}

export function finishJob(id: number) {

    const job = jobs.get(id);

    if (!job) return;

    const duration = Date.now() - job.startedAt;

    jobs.delete(id);

    return {

        ...job,

        duration,

    };

}

export function currentJobs() {

    return jobs.size;

}

export function runningJobs() {

    return [...jobs.values()];

}