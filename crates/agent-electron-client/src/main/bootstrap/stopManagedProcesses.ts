interface ManagedProcessStop {
  stopAsync(): Promise<{ success: boolean; message?: string }>;
}

/** Do not let app.exit discard pending process-tree termination/escalation. */
export async function stopManagedProcesses(
  processes: ManagedProcessStop[],
): Promise<void> {
  const results = await Promise.allSettled(
    processes.map((process) => process.stopAsync()),
  );
  const errors = results.flatMap((result) =>
    result.status === "rejected"
      ? [String(result.reason)]
      : result.value.success
        ? []
        : [result.value.message || "Process exit not confirmed"],
  );
  if (errors.length)
    throw new Error(`Managed process shutdown failed: ${errors.join("; ")}`);
}
