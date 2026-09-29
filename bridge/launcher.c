/*
 * AppleMCPBridge launcher: runs a Python bridge script with this app bundle
 * as its TCC responsible process.
 *
 *   AppleMCPBridge.app/Contents/MacOS/AppleMCPBridge <python> <script> [args...]
 *
 * Why this exists: TCC attributes a privacy request to the *responsible*
 * process, which a child inherits from its parent. Under the Claude desktop
 * app the server runs as `disclaimer --pgroup -- bun ...`, so bun is
 * responsible for the bridges. bun is a bare CLI binary with no Info.plist,
 * and TCC refuses full Calendar access to it by service policy without ever
 * prompting (authValue=0, authReason=5). Contacts is refused the same way.
 *
 * A process inside an app bundle whose Info.plist declares usage strings can
 * be prompted, and the grant is remembered for the bundle. But being a child
 * of bun is not enough - it would still inherit bun as responsible. So the
 * launcher re-spawns itself with the responsibility-disclaim spawn attribute,
 * which makes that copy responsible for itself, and the copy then spawns
 * python normally so python inherits the bundle as its responsible process.
 *
 *   bun -> launcher -> launcher (disclaimed, responsible) -> python
 *
 * stdio is inherited throughout, so the bridge's JSON reaches the caller
 * unchanged, and the exit status is propagated back up.
 */

#include <dlfcn.h>
#include <errno.h>
#include <mach-o/dyld.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

/* Set in the environment of the disclaimed copy so it knows its role. */
#define ROLE_ENV "APPLE_MCP_BRIDGE_DISCLAIMED"

static volatile pid_t child_pid = 0;

/* A timeout in the caller signals the outermost launcher; pass it down so the
 * python process does not outlive the request. */
static void forward_signal(int sig) {
  if (child_pid > 0) kill(child_pid, sig);
}

static int wait_for(pid_t pid) {
  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) {
      perror("AppleMCPBridge: waitpid");
      return 1;
    }
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static int spawn_and_wait(const char *path, char *const argv[],
                          posix_spawnattr_t *attr) {
  pid_t pid;
  int err = posix_spawn(&pid, path, NULL, attr, argv, environ);
  if (err != 0) {
    fprintf(stderr, "AppleMCPBridge: cannot spawn %s: %s\n", path,
            strerror(err));
    return 127;
  }
  child_pid = pid;
  return wait_for(pid);
}

/* responsibility_spawnattrs_setdisclaim is SPI in libSystem, so resolve it at
 * runtime rather than linking against it. */
typedef int (*setdisclaim_fn)(posix_spawnattr_t *, int);

static int respawn_disclaimed(int argc, char *argv[]) {
  char self[4096];
  uint32_t size = sizeof(self);
  if (_NSGetExecutablePath(self, &size) != 0) {
    fprintf(stderr, "AppleMCPBridge: executable path too long\n");
    return 1;
  }

  setdisclaim_fn setdisclaim =
      (setdisclaim_fn)dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
  if (setdisclaim == NULL) {
    fprintf(stderr,
            "AppleMCPBridge: responsibility_spawnattrs_setdisclaim is "
            "unavailable on this macOS\n");
    return 1;
  }

  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  setdisclaim(&attr, 1);

  setenv(ROLE_ENV, "1", 1);
  argv[0] = self;
  (void)argc;
  int rc = spawn_and_wait(self, argv, &attr);
  posix_spawnattr_destroy(&attr);
  return rc;
}

int main(int argc, char *argv[]) {
  if (argc < 3) {
    fprintf(stderr, "usage: %s <python> <script> [args...]\n", argv[0]);
    return 64;
  }

  signal(SIGTERM, forward_signal);
  signal(SIGINT, forward_signal);
  signal(SIGHUP, forward_signal);

  const char *role = getenv(ROLE_ENV);
  if (role == NULL || strcmp(role, "1") != 0) {
    return respawn_disclaimed(argc, argv);
  }

  /* Disclaimed copy: we are now responsible. Keep the marker out of python's
   * environment and run the bridge as our child. */
  unsetenv(ROLE_ENV);
  return spawn_and_wait(argv[1], &argv[1], NULL);
}
