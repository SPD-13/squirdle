DEV_IMAGE  := squirdle-dev
PROD_IMAGE := squirdle
PORT       ?= 80

.PHONY: dev test test-unit dev-image build run

# Serve public/ with the same nginx config as production; edits show up on reload.
dev:
	docker run --rm -it -p $(PORT):80 \
		-v "$(CURDIR)/public:/usr/share/nginx/html:ro,z" \
		-v "$(CURDIR)/nginx.conf:/etc/nginx/conf.d/default.conf:ro,z" \
		nginx:1.31-alpine

dev-image:
	docker build -f Dockerfile.dev -t $(DEV_IMAGE) .

# Unit + end-to-end tests. Screenshots land in test-results/.
test: dev-image
	mkdir -p test-results
	docker run --rm --ipc=host --user "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR)/test-results:/app/test-results:z" $(DEV_IMAGE)

test-unit: dev-image
	docker run --rm $(DEV_IMAGE) npm run test:unit

build:
	docker build -t $(PROD_IMAGE) .

run: build
	docker run --rm -it -p $(PORT):80 $(PROD_IMAGE)
