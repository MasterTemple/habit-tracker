use serde_json::json;

fn sample() -> serde_json::Value {
    let bars = |goal: Option<f64>| -> Vec<serde_json::Value> {
        (0..14)
            .map(|i| {
                let actual = ((i * 37) % 140) as f64;
                let state = match goal {
                    None => "success",
                    Some(g) if i == 13 => { let _ = g; "open" }
                    Some(g) if actual >= g => "success",
                    Some(_) => "failure",
                };
                json!({ "label": format!("9/{}", 23 + i), "actual": actual, "goal": goal, "state": state })
            })
            .collect()
    };
    json!({
        "title": "blake's weekly report",
        "window": "Sep 30 – Oct 6",
        "generated": "Oct 7, 2026, 6:00 PM",
        "met": 12, "total": 20,
        "tasks": [
            { "name": "Pull-ups", "color": "#ef4444", "kind": "accumulate", "summary": "met 3 of 7 days · 520 reps",
              "streak": 2, "period": "day", "bars": bars(Some(100.0)) },
            { "name": "Coffee #[panic()] $x$ <evil>", "color": "#64748b", "kind": "track", "summary": "21 cups",
              "streak": 0, "period": "day", "bars": bars(None) },
        ]
    })
}

#[test]
fn renders_a_report() {
    let pdf = habit_pdf::report_pdf(&sample()).expect("renders");
    assert!(pdf.starts_with(b"%PDF-"));
    assert!(pdf.len() > 5_000);
    if let Ok(path) = std::env::var("REPORT_PDF_OUT") {
        std::fs::write(path, &pdf).unwrap();
    }
}

#[test]
fn renders_an_empty_report() {
    let data =
        json!({ "title": "t", "window": "w", "generated": "g", "met": 0, "total": 0, "tasks": [] });
    assert!(habit_pdf::report_pdf(&data).unwrap().starts_with(b"%PDF-"));
}
