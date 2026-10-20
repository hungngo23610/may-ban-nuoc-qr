
const http = require("http");

const STK = process.env.STK;
const BANK = process.env.BANK || "ICB";
const API_KEY = process.env.API_KEY;

const donHang = {};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8"
        });
        res.end("May ban nuoc QR server dang hoat dong");
    }

    else if (req.method === "POST" && url.pathname === "/tao-don") {
        let body = "";

        req.on("data", data => body += data);

        req.on("end", () => {
            try {
                const don = JSON.parse(body);
                const maDon = "DH" + Date.now();

                let gia = 0;

                if (don.sanPham === "Tra") gia = 10000;
                else if (don.sanPham === "Ca phe") gia = 15000;

                if (gia === 0) {
                    res.writeHead(400);
                    res.end(JSON.stringify({
                        loi: "San pham khong hop le"
                    }));
                    return;
                }

                if (!STK || !API_KEY) {
                    res.writeHead(500);
                    res.end(JSON.stringify({
                        loi: "Server chua duoc cau hinh"
                    }));
                    return;
                }

                const qr = "https://qr.sepay.vn/img?acc=" + encodeURIComponent(STK)
                    + "&bank=" + encodeURIComponent(BANK)
                    + "&amount=" + gia
                    + "&des=" + encodeURIComponent("SEVQR " + maDon);

                donHang[maDon] = {
                    sanPham: don.sanPham,
                    soTien: gia,
                    trangThai: "cho_thanh_toan"
                };

                console.log("Tao don:", maDon, gia);

                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8"
                });

                res.end(JSON.stringify({
                    maDon: maDon,
                    soTien: gia,
                    qrUrl: qr,
                    trangThai: "cho_thanh_toan"
                }));
            } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    loi: "Du lieu JSON khong hop le"
                }));
            }
        });
    }

    else if (req.method === "GET" && url.pathname === "/trang-thai") {
        const maDon = url.searchParams.get("maDon");
        const don = donHang[maDon];

        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8"
        });

        if (!don) {
            res.end(JSON.stringify({
                trangThai: "khong_tim_thay"
            }));
        } else {
            res.end(JSON.stringify({
                maDon: maDon,
                trangThai: don.trangThai,
                soTien: don.soTien
            }));
        }
    }

    else if (req.method === "POST" && url.pathname === "/webhook/sepay") {
        if (!API_KEY ||
            req.headers.authorization !== "Apikey " + API_KEY) {
            res.writeHead(401);
            res.end("Sai API Key");
            return;
        }

        let body = "";

        req.on("data", data => body += data);

        req.on("end", () => {
            try {
                const gd = JSON.parse(body);

                const noiDung = String(gd.content || "").toUpperCase();
                const tienNhan = Number(gd.transferAmount);
                const tienVao =
                    String(gd.transferType || "").toLowerCase() === "in";

                let daCapNhat = false;

                if (tienVao) {
                    for (const maDon in donHang) {
                        const don = donHang[maDon];

                        if (
                            noiDung.includes(maDon.toUpperCase()) &&
                            tienNhan === don.soTien &&
                            don.trangThai === "cho_thanh_toan"
                        ) {
                            don.trangThai = "thanh_cong";
                            daCapNhat = true;

                            console.log("DA THANH TOAN:", maDon);
                            break;
                        }
                    }
                }

                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8"
                });

                res.end(JSON.stringify({
                    success: true,
                    daCapNhat: daCapNhat
                }));
            } catch (err) {
                res.writeHead(400);
                res.end("Du lieu loi");
            }
        });
    }

    else {
        res.writeHead(404);
        res.end("Khong tim thay");
    }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("Server dang chay tai cong " + PORT);
});
