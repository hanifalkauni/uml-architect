package com.example.payment;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Autowired;

@RestController
@RequestMapping("/api/v1/payments")
public class PaymentController {
    @Autowired
    private PaymentService paymentService;

    @PostMapping("/charge")
    public ResponseEntity<?> chargeCustomer(@RequestBody ChargeRequest req) {
        try {
            PaymentResult res = paymentService.processCharge(req);
            return ResponseEntity.ok(res);
        } catch (InsufficientFundsException e) {
            return ResponseEntity.status(402).body("LOW_BALANCE");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("SERVER_ERROR");
        }
    }
}
