#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static int parse_port(const char *url) {
  const char *prefix = "http://127.0.0.1:";
  if (url == NULL || strncmp(url, prefix, strlen(prefix)) != 0) return -1;
  char *end = NULL;
  long port = strtol(url + strlen(prefix), &end, 10);
  if (port < 1 || port > 65535 || end == NULL || (*end != '\0' && strcmp(end, "/") != 0)) return -1;
  return (int)port;
}

static int send_bootstrap(int port) {
  int socket_fd = socket(AF_INET, SOCK_STREAM, 0);
  if (socket_fd < 0) return 20;
  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_port = htons((unsigned short)port);
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (connect(socket_fd, (struct sockaddr *)&address, sizeof(address)) != 0) { close(socket_fd); return 21; }
  char request[256];
  int length = snprintf(request, sizeof(request), "HEAD / HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\n\r\n", port);
  if (length <= 0 || (size_t)length >= sizeof(request)) { close(socket_fd); return 22; }
  size_t sent = 0;
  while (sent < (size_t)length) {
    ssize_t count = write(socket_fd, request + sent, (size_t)length - sent);
    if (count <= 0) { close(socket_fd); return 23; }
    sent += (size_t)count;
  }
  char response[4096];
  size_t received = 0;
  while (received + 1 < sizeof(response)) {
    ssize_t count = read(socket_fd, response + received, sizeof(response) - received - 1);
    if (count < 0) { close(socket_fd); return 24; }
    if (count == 0) break;
    received += (size_t)count;
  }
  close(socket_fd);
  response[received] = '\0';
  if (strstr(response, "HTTP/1.1 200 ") != response || strstr(response, "content-length: 0\r\n") == NULL || strstr(response, "connection: close\r\n") == NULL) return 25;
  return 0;
}

static int send_attempt(int port, const char *custom, const char *api_key, const char *auth_token) {
  const char *body = "{\"messages\":[{\"content\":\"Return exactly the synthetic marker output.complete.\",\"role\":\"user\"}],\"model\":\"claude-sonnet-4-6\",\"stream\":true}";
  char request[16384];
  char canonical_custom[4096];
  size_t custom_length = 0;
  if (custom != NULL) {
    for (size_t index = 0; custom[index] != '\0'; index++) {
      if (custom_length + 2 >= sizeof(canonical_custom)) return 10;
      if (custom[index] == '\n') {
        canonical_custom[custom_length++] = '\r';
        canonical_custom[custom_length++] = '\n';
      } else if (custom[index] != '\r') canonical_custom[custom_length++] = custom[index];
    }
  }
  canonical_custom[custom_length] = '\0';
  int length = snprintf(request, sizeof(request),
    "POST /v1/messages?beta=true HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\n%s%s%s%s%s\r\n%s",
    port, strlen(body),
    canonical_custom,
    canonical_custom[0] == '\0' ? "" : "\r\n",
    auth_token == NULL ? "" : "Authorization: Bearer ",
    auth_token == NULL ? "" : auth_token,
    auth_token == NULL ? "" : "\r\n",
    body);
  if (api_key != NULL) {
    char with_key[16384];
    int key_length = snprintf(with_key, sizeof(with_key),
      "POST /v1/messages?beta=true HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\n%s%s%s%s%s%s%s\r\n\r\n%s",
      port, strlen(body), canonical_custom,
      canonical_custom[0] == '\0' ? "" : "\r\n",
      auth_token == NULL ? "" : "Authorization: Bearer ", auth_token == NULL ? "" : auth_token,
      auth_token == NULL ? "" : "\r\n", "x-api-key: ", api_key, body);
    if (key_length <= 0 || (size_t)key_length >= sizeof(with_key)) return 11;
    memcpy(request, with_key, (size_t)key_length + 1);
    length = key_length;
  }
  if (length <= 0 || (size_t)length >= sizeof(request)) return 12;

  int socket_fd = socket(AF_INET, SOCK_STREAM, 0);
  if (socket_fd < 0) return 13;
  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_port = htons((unsigned short)port);
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (connect(socket_fd, (struct sockaddr *)&address, sizeof(address)) != 0) { close(socket_fd); return 14; }
  size_t sent = 0;
  while (sent < (size_t)length) {
    ssize_t count = write(socket_fd, request + sent, (size_t)length - sent);
    if (count <= 0) { close(socket_fd); return 15; }
    sent += (size_t)count;
  }
  char response[32768];
  while (read(socket_fd, response, sizeof(response)) > 0) {}
  close(socket_fd);
  return 0;
}

int main(void) {
  int forbidden = open("/etc/passwd", O_RDONLY);
  if (forbidden >= 0) { close(forbidden); return 90; }
  const char *url = getenv("ANTHROPIC_BASE_URL");
  if (url == NULL) url = getenv("ORACLE_PHASE3B_SELECTED_BASE_URL");
  int port = parse_port(url);
  int attempts = atoi(getenv("ORACLE_PHASE3B_MAX_ATTEMPTS") == NULL ? "0" : getenv("ORACLE_PHASE3B_MAX_ATTEMPTS"));
  if (port < 1 || attempts < 1 || attempts > 2) return 91;
  int bootstrap = send_bootstrap(port);
  if (bootstrap != 0) return bootstrap;
  for (int attempt = 0; attempt < attempts; attempt++) {
    int result = send_attempt(port, getenv("ANTHROPIC_CUSTOM_HEADERS"), getenv("ANTHROPIC_API_KEY"), getenv("ANTHROPIC_AUTH_TOKEN"));
    if (result != 0 && attempt + 1 == attempts) return result;
  }
  if (strcmp(getenv("ORACLE_PHASE3B_EXPECT_COMPLETE") == NULL ? "0" : getenv("ORACLE_PHASE3B_EXPECT_COMPLETE"), "1") == 0) puts("{\"result\":\"output.complete\"}");
  return strcmp(getenv("ORACLE_PHASE3B_EXPECT_FAILURE") == NULL ? "0" : getenv("ORACLE_PHASE3B_EXPECT_FAILURE"), "1") == 0 ? 3 : 0;
}
