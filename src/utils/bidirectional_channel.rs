use anyhow::Result;
use tokio::sync::mpsc::{self, Receiver, Sender};

pub struct Requester<Req, Resp> {
    request_send: Sender<Req>,
    response_recv: Receiver<Resp>,
}

impl<Req, Resp> Requester<Req, Resp> {
    pub async fn request(&mut self, req: Req) -> Result<Resp> {
        self.send(req).await?;
        self.recv().await
    }

    pub async fn send(&mut self, req: Req) -> Result<()> {
        self.request_send
            .send(req)
            .await
            .map_err(|_| anyhow::anyhow!("Request channel closed"))
    }

    pub async fn recv(&mut self) -> Result<Resp> {
        self.response_recv
            .recv()
            .await
            .ok_or_else(|| anyhow::anyhow!("Response channel closed"))
    }
}

pub struct Responder<Req, Resp> {
    request_recv: Receiver<Req>,
    response_send: Sender<Resp>,
}

impl<Req, Resp> Responder<Req, Resp> {
    pub async fn recv(&mut self) -> Option<Req> {
        self.request_recv.recv().await
    }

    pub async fn send(&self, resp: Resp) -> Result<(), mpsc::error::SendError<Resp>> {
        self.response_send.send(resp).await
    }

    #[allow(dead_code)]
    pub async fn handle<F, Fut>(&mut self, mut handler: F)
    where
        F: FnMut(Req) -> Fut,
        Fut: std::future::Future<Output = Resp>,
    {
        while let Some(req) = self.request_recv.recv().await {
            let resp = handler(req).await;
            if self.response_send.send(resp).await.is_err() {
                break;
            }
        }
    }
}

pub fn channel<Req, Resp>(buffer: usize) -> (Requester<Req, Resp>, Responder<Req, Resp>) {
    let (request_send, request_recv) = mpsc::channel(buffer);
    let (response_send, response_recv) = mpsc::channel(buffer);

    (
        Requester {
            request_send,
            response_recv,
        },
        Responder {
            request_recv,
            response_send,
        },
    )
}
