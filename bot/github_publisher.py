from github import Github, GithubException, UnknownObjectException
from github import Auth

from bot.config import GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME, log


class GithubPublisher:
    def __init__(self):
        self.client = None
        self.repo = None

    def connect(self):
        auth = Auth.Token(GITHUB_TOKEN)
        self.client = Github(auth=auth)
        self.repo = self.client.get_repo(f"{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}")
        log.info("GitHub connected")

    def update_file_if_needed(self, filename: str, content: str) -> bool:
        try:
            contents = self.repo.get_contents(filename)
            old = contents.decoded_content.decode("utf-8")
            if old == content:
                return False
            self.repo.update_file(contents.path, "Update whitelist output", content, contents.sha)
            return True
        except UnknownObjectException:
            self.repo.create_file(filename, "Create whitelist output", content)
            return True
        except GithubException:
            log.exception("GitHub API error updating %s", filename)
            raise
